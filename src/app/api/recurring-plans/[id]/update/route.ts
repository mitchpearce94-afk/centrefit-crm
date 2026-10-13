import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getAuthedClient } from "@/lib/xero/client";
import { brisbaneDateISO } from "@/lib/dates";
import {
  cancelSubscription,
  createSubscription,
  getMandate,
  getSubscription,
  updateSubscription,
  type GcSubscription,
} from "@/lib/gocardless/client";
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
 * The GoCardless subscription(s) are re-priced to the new cadence totals
 * (net of any add-on subscriptions that bill separately), created when a
 * cadence is newly populated, and cancelled when a cadence empties. The
 * mandate itself is untouched. Without this the next debit collects the old
 * amount while Xero invoices the new one.
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
      gc_mandate_id, gc_subscription_id, gc_subscription_secondary_id,
      customer_sites(name), customers(name),
      recurring_plan_items(id, service_id, frequency),
      recurring_plan_gc_subscriptions(gc_subscription_id, amount_cents, interval_unit, gc_status)
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

  // ─── Sync Xero + GoCardless (active plans only) ───────────────────────────
  if (plan.status !== "active") {
    // Pre-active plans: no Xero RI or GC subscription exists yet. Items are
    // picked up when the mandate goes active and activatePlan() runs in the
    // GC webhook.
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

  const errors: string[] = [];
  const today = brisbaneDateISO();
  const errMsg = (err: unknown) => (err instanceof Error ? err.message : String(err));
  const dollars = (cents: number) => `$${(cents / 100).toFixed(2)}`;

  // ─── Xero ──────────────────────────────────────────────────────────────────
  // Determine which old RI is monthly vs yearly by reading its schedule — we
  // don't store a "which cadence is the primary RI" flag.
  let monthlyRiId: string | null = null;
  let yearlyRiId: string | null = null;
  let xeroSynced = false;
  if (plan.xero_contact_id) {
    try {
      const { client, conn } = await getAuthedClient();
      for (const riId of [plan.xero_repeating_invoice_id, plan.xero_repeating_invoice_secondary_id].filter(Boolean) as string[]) {
        const res = await client.accountingApi.getRepeatingInvoice(conn.tenant_id, riId);
        const ri = res.body.repeatingInvoices?.[0];
        const period = Number(ri?.schedule?.period ?? 1);
        if (period >= 12) yearlyRiId = riId;
        else monthlyRiId = riId;
      }
      const xeroContactId = plan.xero_contact_id;

      for (const freq of ["monthly", "yearly"] as PlanFrequency[]) {
        const newLines = linesByFreq.get(freq) ?? [];
        const oldRiId = freq === "monthly" ? monthlyRiId : yearlyRiId;

        if (newLines.length === 0 && oldRiId) {
          // Cadence emptied — cancel its RI.
          try { await cancelRepeatingInvoice(client, conn.tenant_id, oldRiId); }
          catch (err) { errors.push(`cancel ${freq} RI: ${errMsg(err)}`); }
          if (freq === "monthly") monthlyRiId = null; else yearlyRiId = null;
        } else if (newLines.length > 0 && oldRiId) {
          // Cadence still has items — put the new lines on its template. A DRAFT
          // template is edited in place; an AUTHORISED one is replaced on the
          // same schedule (Xero refuses edits to AUTHORISED templates), so the
          // id we persist may change. Unchanged lines are a no-op.
          try {
            const r = await updateRepeatingInvoiceLines(client, conn.tenant_id, oldRiId, newLines);
            if (freq === "monthly") monthlyRiId = r.repeatingInvoiceID; else yearlyRiId = r.repeatingInvoiceID;
          } catch (err) { errors.push(`update ${freq} RI: ${errMsg(err)}`); }
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
            errors.push(`create ${freq} RI: ${errMsg(err)}`);
          }
        }
      }
      xeroSynced = true;
    } catch (err) {
      errors.push(`Xero: ${errMsg(err)}`);
    }
  }

  // ─── GoCardless ────────────────────────────────────────────────────────────
  // A subscription carries a FIXED amount; the mandate only authorises the
  // debit. If the plan's services change, the plan-level subscription for that
  // cadence must be re-priced, created or cancelled to match — otherwise the
  // next debit silently collects the old total while Xero invoices the new one
  // (Golden Bay, Oct 2026: invoiced $96.25, collected $24.75).
  //
  // Add-on services billed on their own subscriptions (add-service flow,
  // imported legacy subs in recurring_plan_gc_subscriptions) already collect
  // their share, so the plan-level subscription covers the remainder only.
  let monthlySubId: string | null = null;
  let yearlySubId: string | null = null;
  let gcSynced = false;
  const gcChanges: string[] = [];
  try {
    const planSubIds = [plan.gc_subscription_id, plan.gc_subscription_secondary_id].filter(Boolean) as string[];
    const subsById = new Map<string, GcSubscription>();
    for (const subId of planSubIds) {
      const sub = await getSubscription(subId);
      subsById.set(subId, sub);
      if (sub.status === "cancelled" || sub.status === "finished") continue;
      if (sub.interval_unit === "yearly") yearlySubId = subId; else monthlySubId = subId;
    }

    const addon: Record<PlanFrequency, number> = { monthly: 0, yearly: 0 };
    for (const link of plan.recurring_plan_gc_subscriptions ?? []) {
      if (!link.gc_subscription_id || planSubIds.includes(link.gc_subscription_id)) continue;
      if (link.gc_status === "cancelled" || link.gc_status === "finished") continue;
      addon[link.interval_unit === "yearly" ? "yearly" : "monthly"] += Number(link.amount_cents ?? 0);
    }

    // A new subscription can't start before the mandate's next possible charge
    // date (GC rejects it with a 422) — same floor activatePlan() applies.
    let earliestCharge: string | null = null;
    if (plan.gc_mandate_id) {
      try { earliestCharge = (await getMandate(plan.gc_mandate_id)).next_possible_charge_date; }
      catch { /* non-fatal: GC will still refuse an impossible date and we surface that */ }
    }
    // Supabase types the to-one joins as arrays here (no generated relation
    // metadata) — accept either shape.
    const rel = (v: unknown): { name?: string | null } | null =>
      Array.isArray(v) ? ((v[0] as { name?: string | null } | undefined) ?? null) : ((v as { name?: string | null } | null) ?? null);
    const siteName = rel(plan.customer_sites)?.name ?? rel(plan.customers)?.name ?? `Plan ${plan.id.slice(0, 8)}`;

    for (const freq of ["monthly", "yearly"] as PlanFrequency[]) {
      try {
        const lines = linesByFreq.get(freq) ?? [];
        const itemsCents = Math.round(lines.reduce((sum, l) => sum + l.unitAmount * (l.quantity ?? 1), 0) * 100);
        const wantCents = itemsCents - addon[freq];
        const subId = freq === "monthly" ? monthlySubId : yearlySubId;

        if (lines.length === 0) {
          // Cadence emptied — stop collecting for it.
          if (subId) {
            await cancelSubscription(subId);
            gcChanges.push(`${freq} subscription cancelled`);
            if (freq === "monthly") monthlySubId = null; else yearlySubId = null;
          }
          continue;
        }
        if (wantCents <= 0) {
          errors.push(`${freq} GoCardless: add-on subscriptions (${dollars(addon[freq])}) already cover the plan total (${dollars(itemsCents)}) — review the subscriptions by hand`);
          continue;
        }
        if (subId) {
          const current = subsById.get(subId)!;
          if (current.amount !== wantCents) {
            await updateSubscription(subId, { amount: wantCents });
            gcChanges.push(`${freq} ${dollars(current.amount)} → ${dollars(wantCents)}`);
          }
        } else if (plan.gc_mandate_id) {
          const start = earliestCharge && earliestCharge > today ? earliestCharge : today;
          const sub = await createSubscription(
            {
              amount: wantCents,
              currency: "AUD",
              interval_unit: freq === "yearly" ? "yearly" : "monthly",
              start_date: start,
              name: `${siteName} (${freq})`,
              metadata: { plan_id: plan.id, cadence: freq },
              links: { mandate: plan.gc_mandate_id },
            },
            `crm-sub-${plan.id.slice(0, 8)}-${freq}-${wantCents}-${today}`,
          );
          if (freq === "monthly") monthlySubId = sub.id; else yearlySubId = sub.id;
          gcChanges.push(`${freq} subscription created ${dollars(wantCents)} from ${start}`);
        } else {
          errors.push(`${freq} GoCardless: plan has no mandate, subscription not created`);
        }
      } catch (err) {
        errors.push(`${freq} GoCardless: ${errMsg(err)}`);
      }
    }
    gcSynced = true;
  } catch (err) {
    errors.push(`GoCardless: ${errMsg(err)}`);
  }

  // ─── Persist ───────────────────────────────────────────────────────────────
  // Only overwrite the id slots we actually reconciled — a failed Xero or GC
  // read must not wipe a stored id. Primary = monthly when both exist.
  const update: Record<string, unknown> = {
    notes: errors.length > 0 ? `Update completed with errors: ${errors.join("; ")}`.slice(0, 1000) : null,
  };
  if (xeroSynced) {
    update.xero_repeating_invoice_id = monthlyRiId ?? yearlyRiId;
    update.xero_repeating_invoice_secondary_id = monthlyRiId && yearlyRiId ? yearlyRiId : null;
  }
  if (gcSynced) {
    update.gc_subscription_id = monthlySubId ?? yearlySubId;
    update.gc_subscription_secondary_id = monthlySubId && yearlySubId ? yearlySubId : null;
  }
  await supabase.from("recurring_plans").update(update).eq("id", plan.id);

  return NextResponse.json({
    status: "updated",
    gocardless: gcChanges,
    warnings: errors.length > 0 ? errors : undefined,
  });
}
