import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { getAuthedClient } from "@/lib/xero/client";
import {
  getRepeatingInvoice,
  updateRepeatingInvoiceSchedule,
} from "@/lib/xero/repeating-invoices";

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

  const svc = createServiceRoleClient();
  let q = svc
    .from("recurring_plans")
    .select(
      "id, yearly_first_invoice_date, xero_repeating_invoice_id, xero_repeating_invoice_secondary_id, customers(name), customer_sites(name)",
    )
    .eq("status", "active")
    .not("yearly_first_invoice_date", "is", null);
  if (planId) q = q.eq("id", planId);
  const { data: plans } = await q;

  const { client: xero, conn } = await getAuthedClient(svc);
  const results: unknown[] = [];
  let patched = 0;
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

    // Signal whether Xero may have already generated a yearly child off the
    // wrong date: either the next-scheduled-date has advanced past the start,
    // or the start is already in the past. Either warrants a manual Xero check.
    const firedRisk =
      currentNext && currentStart && currentNext !== currentStart
        ? `next-scheduled ${currentNext} ≠ start ${currentStart} — a child may already have generated`
        : currentStart && currentStart < todayStr
          ? `start ${currentStart} is in the past — a child may already have generated`
          : null;
    const base = { planId: plan.id, label, riId: yearlyRiId, total, currentStart, currentNext, wanted, firedRisk };

    if (currentStart === wanted) {
      results.push({ ...base, action: "ok" });
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
}
