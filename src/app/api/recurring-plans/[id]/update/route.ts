import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getAuthedClient } from "@/lib/xero/client";
import {
  createRepeatingInvoice,
  cancelRepeatingInvoice,
  updateRepeatingInvoiceLines,
  type PlanFrequency,
  type RepeatingInvoiceLineInput,
} from "@/lib/xero/repeating-invoices";

/**
 * POST /api/recurring-plans/[id]/update
 *
 * Body: { items: [{ serviceId: uuid, quantity?: number }] }
 *
 * Replace the plan's services with the new list. Updates DB items + the
 * Xero RepeatingInvoice template(s) accordingly:
 *
 *   - Cadence still has items   → update RI lineItems in place (schedule
 *                                  preserved, next scheduled run unchanged)
 *   - Cadence had RI, now empty → cancel that RI
 *   - Cadence has new items, no RI yet → create a new RI starting today
 *
 * The GoCardless mandate is unchanged — DD authority is amount-agnostic,
 * the next debit just pulls the new total.
 *
 * Already-issued child invoices for the current period are NOT modified
 * (Xero would have sent them already; this only affects future runs).
 */
export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;

  let body: { items?: Array<{ serviceId: string; quantity?: number }> };
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  if (!Array.isArray(body.items) || body.items.length === 0) {
    return NextResponse.json({ error: "Must keep at least one service. Cancel the plan if you want to stop everything." }, { status: 400 });
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });

  // Pull current plan + items.
  const { data: plan, error: planErr } = await supabase
    .from("recurring_plans")
    .select(`
      id, status, customer_id, site_id, xero_contact_id,
      xero_repeating_invoice_id, xero_repeating_invoice_secondary_id,
      recurring_plan_items(id, service_id, frequency)
    `)
    .eq("id", id)
    .maybeSingle();
  if (planErr || !plan) return NextResponse.json({ error: "Plan not found" }, { status: 404 });
  if (plan.status === "cancelled") {
    return NextResponse.json({ error: "Cancelled plans can't be edited. Create a new plan instead." }, { status: 400 });
  }

  // Pull catalogue snapshot for the requested service IDs.
  const requestedIds = Array.from(new Set(body.items.map((i) => i.serviceId)));
  const { data: services } = await supabase
    .from("recurring_services")
    .select("id, code, name, description, price_inc_gst, frequency, account_code, active")
    .in("id", requestedIds);
  const servicesById = new Map((services ?? []).map((s) => [s.id, s]));
  for (const itemId of requestedIds) {
    const svc = servicesById.get(itemId);
    if (!svc) return NextResponse.json({ error: `Unknown service: ${itemId}` }, { status: 400 });
    if (!svc.active) return NextResponse.json({ error: `Service is deactivated: ${svc.name}` }, { status: 400 });
  }

  // ─── Replace items in DB ───────────────────────────────────────────────────
  // Strategy: drop all existing items, insert the new set. Simpler than
  // diff-and-update and the items table is just a snapshot anyway.
  const { error: delErr } = await supabase
    .from("recurring_plan_items")
    .delete()
    .eq("recurring_plan_id", plan.id);
  if (delErr) return NextResponse.json({ error: `Item replace failed: ${delErr.message}` }, { status: 500 });

  const itemRows = body.items.map((it) => {
    const svc = servicesById.get(it.serviceId)!;
    return {
      recurring_plan_id: plan.id,
      service_id: svc.id,
      service_code: svc.code,
      service_name: svc.name,
      description: svc.description,
      price_inc_gst: svc.price_inc_gst,
      frequency: svc.frequency,
      account_code: svc.account_code,
      quantity: it.quantity ?? 1,
    };
  });
  const { error: insErr } = await supabase.from("recurring_plan_items").insert(itemRows);
  if (insErr) return NextResponse.json({ error: `Item insert failed: ${insErr.message}` }, { status: 500 });

  // ─── Sync Xero (only if plan is active and we have an RI to manipulate) ───
  if (plan.status !== "active" || !plan.xero_contact_id) {
    // Pre-active plans: no Xero RI exists yet. Items will be picked up when
    // the mandate goes active and activatePlan() runs in the GC webhook.
    return NextResponse.json({ status: "items_updated_pre_active" });
  }

  // Group new items by cadence + build line inputs.
  const linesByFreq = new Map<PlanFrequency, RepeatingInvoiceLineInput[]>();
  for (const row of itemRows) {
    const freq = row.frequency as PlanFrequency;
    if (!linesByFreq.has(freq)) linesByFreq.set(freq, []);
    linesByFreq.get(freq)!.push({
      description: row.description ?? row.service_name,
      quantity: row.quantity,
      unitAmount: Number(row.price_inc_gst),
      accountCode: row.account_code,
    });
  }

  const oldHasMonthly = !!plan.xero_repeating_invoice_id;
  const oldHasYearly = !!plan.xero_repeating_invoice_secondary_id;
  // The "primary" slot used to be monthly when both existed — see
  // activatePlan() in /api/gocardless/webhook. If only yearly existed, it
  // sat in the primary slot.
  const oldMonthlyRiId = oldHasMonthly && oldHasYearly ? plan.xero_repeating_invoice_id : (oldHasMonthly && !oldHasYearly ? null : null);
  // Reading note: the heuristic here is genuinely ambiguous — we don't
  // store a "which cadence is the primary RI" flag. To make the diff
  // robust, fetch each existing RI and read its schedule.
  const { client, conn } = await getAuthedClient();

  // Determine which old RI is monthly vs yearly by looking at scheduled period.
  let monthlyRiId: string | null = null;
  let yearlyRiId: string | null = null;
  for (const riId of [plan.xero_repeating_invoice_id, plan.xero_repeating_invoice_secondary_id].filter(Boolean) as string[]) {
    const res = await client.accountingApi.getRepeatingInvoice(conn.tenant_id, riId);
    const ri = res.body.repeatingInvoices?.[0];
    const period = Number(ri?.schedule?.period ?? 1);
    if (period >= 12) yearlyRiId = riId;
    else monthlyRiId = riId;
  }

  const errors: string[] = [];
  const today = new Date().toISOString().slice(0, 10);

  // Resolve the contact ID we'll use for any newly-created RIs.
  const xeroContactId = plan.xero_contact_id;

  for (const freq of ["monthly", "yearly"] as PlanFrequency[]) {
    const newLines = linesByFreq.get(freq) ?? [];
    const oldRiId = freq === "monthly" ? monthlyRiId : yearlyRiId;

    if (newLines.length === 0 && oldRiId) {
      // Cadence emptied — cancel its RI.
      try { await cancelRepeatingInvoice(client, conn.tenant_id, oldRiId); }
      catch (err) { errors.push(`cancel ${freq} RI: ${err instanceof Error ? err.message : String(err)}`); }
      if (freq === "monthly") monthlyRiId = null; else yearlyRiId = null;
    } else if (newLines.length > 0 && oldRiId) {
      // Cadence still has items — update lines in place. Schedule preserved.
      try { await updateRepeatingInvoiceLines(client, conn.tenant_id, oldRiId, newLines); }
      catch (err) { errors.push(`update ${freq} RI: ${err instanceof Error ? err.message : String(err)}`); }
    } else if (newLines.length > 0 && !oldRiId) {
      // Cadence newly populated — create a fresh RI starting today.
      try {
        const ri = await createRepeatingInvoice({
          xero: client,
          tenantId: conn.tenant_id,
          xeroContactId,
          reference: `Plan ${plan.id.slice(0, 8)}`,
          frequency: freq,
          startDate: today,
          dueDays: 7,
          // childStatus defaults to "DRAFT" — see repeating-invoices.ts.
          // After 2026-05-11 incident we never default AUTHORISED here.
          lineItems: newLines,
        });
        if (freq === "monthly") monthlyRiId = ri.repeatingInvoiceID; else yearlyRiId = ri.repeatingInvoiceID;
      } catch (err) {
        errors.push(`create ${freq} RI: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  // Persist the new RI ID layout. Primary = monthly when both exist.
  const primary = monthlyRiId ?? yearlyRiId;
  const secondary = monthlyRiId && yearlyRiId ? yearlyRiId : null;
  await supabase
    .from("recurring_plans")
    .update({
      xero_repeating_invoice_id: primary,
      xero_repeating_invoice_secondary_id: secondary,
      notes: errors.length > 0 ? `Update completed with errors: ${errors.join("; ")}`.slice(0, 1000) : null,
    })
    .eq("id", plan.id);

  return NextResponse.json({
    status: "updated",
    warnings: errors.length > 0 ? errors : undefined,
  });
}
