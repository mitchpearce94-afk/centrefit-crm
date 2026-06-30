import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { getAuthedClient } from "@/lib/xero/client";
import {
  getRepeatingInvoice,
  updateRepeatingInvoiceSchedule,
} from "@/lib/xero/repeating-invoices";

// Up to ~16 sequential Xero calls with 500ms pacing — give it room so a slow
// run can't be killed mid-write by the default function timeout.
export const maxDuration = 60;

/**
 * Reconcile yearly RepeatingInvoice StartDates against the plan's
 * `yearly_first_invoice_date`.
 *
 * Before 2026-06-30, activate-plan passed the MONTHLY start date to every
 * cadence's Xero RI, so any plan with a yearly cadence got its yearly invoice
 * scheduled on the monthly date (Estella: set 9/2/27, Xero used 19/7/26). The
 * GC subscription was always correct, so only the Xero side drifted.
 *
 * For each active plan with a yearly date set, this finds the yearly RI (the
 * one Xero holds as MONTHLY × 12) among the plan's cached RI IDs and, if its
 * StartDate disagrees with the plan's yearly date, reschedules it.
 *
 * Dry-run by default. Pass `?apply=1` to actually patch. Optional `?planId=`
 * scopes to a single plan. Rescheduling a not-yet-fired RI is NOT
 * customer-facing (no email/charge now) — it only moves the next run date.
 */

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface PlanRow {
  id: string;
  yearly_first_invoice_date: string | null;
  xero_repeating_invoice_id: string | null;
  xero_repeating_invoice_secondary_id: string | null;
  customers: { name: string | null } | { name: string | null }[] | null;
  customer_sites: { name: string | null } | { name: string | null }[] | null;
}

function nameOf(v: { name: string | null } | { name: string | null }[] | null): string | null {
  const r = Array.isArray(v) ? v[0] : v;
  return r?.name ?? null;
}

export async function GET(req: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });

  const url = new URL(req.url);
  const apply = url.searchParams.get("apply") === "1";
  const planId = url.searchParams.get("planId");
  const todayStr = new Date().toISOString().slice(0, 10);

  // Surface any failure (Xero auth/refresh, query, write) as readable JSON
  // instead of a bare 500, with the stage it died at and whatever completed.
  const results: unknown[] = [];
  let patched = 0;
  let stage = "query";
  try {
  const svc = createServiceRoleClient();
  let q = svc
    .from("recurring_plans")
    .select(
      "id, yearly_first_invoice_date, xero_repeating_invoice_id, xero_repeating_invoice_secondary_id, customers(name), customer_sites(name)",
    )
    .eq("status", "active")
    .not("yearly_first_invoice_date", "is", null);
  if (planId) q = q.eq("id", planId);
  const { data: plans, error: planErr } = await q;
  if (planErr) throw new Error(`plan query failed: ${planErr.message}`);

  stage = "xero_auth";
  const { client: xero, conn } = await getAuthedClient(svc);
  stage = "scan";
  let first = true;

  for (const plan of (plans ?? []) as PlanRow[]) {
    const wanted = plan.yearly_first_invoice_date!;
    const label = nameOf(plan.customer_sites) ?? nameOf(plan.customers) ?? plan.id.slice(0, 8);
    const riIds = [
      plan.xero_repeating_invoice_id,
      plan.xero_repeating_invoice_secondary_id,
    ].filter((x): x is string => !!x);

    // Identify the yearly RI by its schedule signature (MONTHLY × 12) rather
    // than assuming primary/secondary — a yearly-only plan keeps its yearly RI
    // as the primary.
    let yearlyRiId: string | null = null;
    let currentStart: string | null = null;
    let currentNext: string | null = null;
    let total: number | null = null;
    for (const riId of riIds) {
      try {
        if (!first) await sleep(500);
        first = false;
        const state = await getRepeatingInvoice(xero, conn.tenant_id, riId);
        if (state.schedulePeriod === 12) {
          yearlyRiId = riId;
          currentStart = state.startDate;
          currentNext = state.nextScheduledDate;
          total = state.total;
          break;
        }
      } catch (err) {
        results.push({
          planId: plan.id,
          riId,
          action: "fetch_failed",
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    if (!yearlyRiId) {
      results.push({ planId: plan.id, label, action: "no_yearly_ri_found" });
      continue;
    }

    // Xero returns these as full ISO timestamps; compare on the date part only.
    const sd = currentStart ? currentStart.slice(0, 10) : null;
    const nd = currentNext ? currentNext.slice(0, 10) : null;
    // If next-scheduled has advanced past the start, Xero has already ISSUED
    // the first yearly off this RI — so its next run (start + 1yr) is now the
    // correct anniversary going forward. Rescheduling such an RI to the
    // originally-intended date could double-issue, so we never auto-touch it;
    // it only needs a manual Xero check for a stray first invoice.
    const fired = !!sd && !!nd && nd !== sd;
    const base = { planId: plan.id, label, riId: yearlyRiId, total, currentStart: sd, currentNext: nd, wanted, fired };

    if (sd === wanted) {
      results.push({ ...base, action: "ok" });
      continue;
    }
    if (fired) {
      results.push({ ...base, action: "skipped_already_fired" });
      continue;
    }
    if (wanted < todayStr) {
      // Can't push a past date into Xero — flag for manual handling.
      results.push({ ...base, action: "skipped_past_date" });
      continue;
    }
    if (!apply) {
      results.push({ ...base, action: "would_fix" });
      continue;
    }

    try {
      await sleep(500);
      const after = await updateRepeatingInvoiceSchedule(
        xero,
        conn.tenant_id,
        yearlyRiId,
        wanted,
      );
      patched++;
      results.push({ ...base, action: "fixed", from: currentStart, to: after.startDate });
    } catch (err) {
      results.push({
        ...base,
        action: "patch_failed",
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return NextResponse.json({
    mode: apply ? "apply" : "dry-run",
    scanned: plans?.length ?? 0,
    patched,
    results,
  });
  } catch (err) {
    // 200 + ok:false so a browser navigation renders the JSON rather than a
    // generic 500 page — we want to SEE the error and what got done first.
    return NextResponse.json({
      ok: false,
      stage,
      error: err instanceof Error ? err.message : String(err),
      patched,
      partialResults: results,
    });
  }
}
