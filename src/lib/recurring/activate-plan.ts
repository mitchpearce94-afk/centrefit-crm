import crypto from "node:crypto";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { getAuthedClient } from "@/lib/xero/client";
import { findOrCreateContact } from "@/lib/xero/contacts";
import { createRepeatingInvoice, type PlanFrequency } from "@/lib/xero/repeating-invoices";
import { enqueueNotification } from "@/lib/notifications/enqueue";

type ServiceClient = ReturnType<typeof createServiceRoleClient>;

export type ActivatePlanResult =
  | { ok: true; skipped: "already_active"; planId: string }
  | { ok: true; activated: true; planId: string; xeroRepeatingInvoiceId: string; startDate: string }
  | { ok: false; reason: string; planId: string };

/**
 * Mandate-linked plan goes "live" in our system:
 *  1. resolve/create the Xero contact (per-site aware)
 *  2. create one Xero RepeatingInvoice template per cadence (monthly/yearly)
 *  3. flip plan status to `active` + cache the RI ID(s) on the plan
 *  4. notify staff
 *
 * Idempotent — re-running on an already-active plan with an RI cached is a
 * no-op. Designed to be triggered from:
 *   - GoCardless `billing_request.fulfilled` (the AU BECS path — mandate
 *     submits lazily when the first payment fires, so we need to provision
 *     the Xero RI ASAP to start the schedule).
 *   - GoCardless `mandate.active` (the UK BACS path — mandate goes active
 *     on signup).
 *   - Admin backfill for plans that pre-date the BR-fulfilled trigger.
 *
 * AU BECS quirk: GoCardless leaves the mandate in `pending_submission` until
 * the first payment is created. We MUST NOT gate this function on mandate
 * status === "active" or the chain dead-ends and the RI is never created.
 */
export async function activatePlan(
  supabase: ServiceClient,
  planId: string,
): Promise<ActivatePlanResult> {
  const { data: plan } = await supabase
    .from("recurring_plans")
    .select(`
      id, status, customer_id, site_id, gc_mandate_id, xero_repeating_invoice_id, first_invoice_date,
      customers(id, name, abn, xero_contact_id, customer_contacts(name, email, phone, is_primary)),
      customer_sites(name, address, suburb, state, postcode, xero_contact_id)
    `)
    .eq("id", planId)
    .single();
  if (!plan) return { ok: false, reason: "plan_not_found", planId };

  // Already activated — idempotent.
  if (plan.status === "active" && plan.xero_repeating_invoice_id) {
    return { ok: true, skipped: "already_active", planId };
  }

  // Pull plan items.
  const { data: items } = await supabase
    .from("recurring_plan_items")
    .select("service_code, service_name, description, price_inc_gst, frequency, account_code, quantity")
    .eq("recurring_plan_id", planId);
  if (!items || items.length === 0) return { ok: false, reason: "no_plan_items", planId };

  // Plans with mixed monthly/yearly need separate Xero RepeatingInvoices,
  // one per cadence. Group items by frequency and create one template per
  // group. We persist the monthly RI id on the plan (the primary one); the
  // yearly id is stashed in a small JSON field if present.
  const byFreq = new Map<PlanFrequency, typeof items>();
  for (const it of items) {
    const key = it.frequency as PlanFrequency;
    if (!byFreq.has(key)) byFreq.set(key, []);
    byFreq.get(key)!.push(it);
  }

  const customer = Array.isArray(plan.customers) ? plan.customers[0] : plan.customers;
  if (!customer) return { ok: false, reason: "no_customer", planId };
  const site = Array.isArray(plan.customer_sites) ? plan.customer_sites[0] : plan.customer_sites;
  const primary =
    customer.customer_contacts?.find((c: { is_primary: boolean }) => c.is_primary) ??
    customer.customer_contacts?.[0];

  const { client: xero, conn } = await getAuthedClient(supabase);

  // Resolve the Xero contact via the site-aware helper so the per-site
  // mapping persists on customer_sites.xero_contact_id and the site address
  // is attached for the invoice "Bill To" block. Helper handles dedupe
  // against pre-existing Xero contacts (loose name match).
  const xeroContactId = await findOrCreateContact(
    supabase,
    xero,
    conn.tenant_id,
    {
      id: customer.id,
      name: customer.name,
      xero_contact_id: customer.xero_contact_id,
      email: primary?.email ?? null,
      phone: primary?.phone ?? null,
      abn: customer.abn ?? null,
    },
    plan.site_id && site
      ? {
          id: plan.site_id,
          name: site.name,
          xero_contact_id: (site as { xero_contact_id?: string | null }).xero_contact_id ?? null,
          address: site.address ?? null,
          suburb: site.suburb ?? null,
          state: site.state ?? null,
          postcode: site.postcode ?? null,
        }
      : null,
  );

  // First invoice fires on the customer-chosen start date. Xero rejects past
  // dates, so a stale pre-active first_invoice_date that's now in the past
  // gets bumped to today. Plans with no start date use today.
  const today = new Date();
  const todayStr = today.toISOString().slice(0, 10);
  const startDate = plan.first_invoice_date && plan.first_invoice_date >= todayStr
    ? plan.first_invoice_date
    : todayStr;

  let monthlyRiId: string | null = null;
  let yearlyRiId: string | null = null;

  for (const [frequency, group] of byFreq.entries()) {
    // Stable per-call idempotency key. Same key on internal SDK retries
    // dedupes server-side at Xero; fresh key per activatePlan invocation
    // means a legitimate retry-after-cleanup doesn't collide with old
    // deleted records.
    const idempotencyKey = `crm-ri-${plan.id.slice(0, 8)}-${frequency}-${crypto.randomUUID().slice(0, 8)}`;
    const ri = await createRepeatingInvoice({
      xero,
      tenantId: conn.tenant_id,
      xeroContactId,
      reference: `Plan ${plan.id.slice(0, 8)}`,
      frequency,
      startDate,
      dueDays: 7,
      // childStatus defaults to "DRAFT" — auto-generated children sit in
      // Mitchell's Xero Draft folder for manual review before authorising
      // and sending. Locked in after the 2026-05-11 auto-send incident.
      idempotencyKey,
      lineItems: group.map((it) => ({
        description: it.description ?? it.service_name,
        quantity: it.quantity,
        unitAmount: Number(it.price_inc_gst),
        accountCode: it.account_code,
      })),
    });
    if (frequency === "monthly") monthlyRiId = ri.repeatingInvoiceID;
    if (frequency === "yearly") yearlyRiId = ri.repeatingInvoiceID;
  }

  // Primary = monthly when both exist (most common cadence). Secondary holds
  // the yearly RI ID so cancel can find both cleanly.
  const primaryRiId = monthlyRiId ?? yearlyRiId;
  const secondaryRiId = monthlyRiId && yearlyRiId ? yearlyRiId : null;

  if (!primaryRiId) return { ok: false, reason: "no_ri_created", planId };

  await supabase
    .from("recurring_plans")
    .update({
      status: "active",
      xero_contact_id: xeroContactId,
      xero_repeating_invoice_id: primaryRiId,
      xero_repeating_invoice_secondary_id: secondaryRiId,
      next_invoice_date: startDate,
    })
    .eq("id", planId);

  await enqueueNotification({
    supabase,
    typeCode: "mandate.active",
    refType: "recurring_plan",
    refId: planId,
    audience: { allActive: true },
    title: `${customer.name} mandate active`,
    body: site?.name
      ? `${site.name} — recurring billing live, first invoice ${startDate}.`
      : `Recurring billing live, first invoice ${startDate}.`,
    href: `/invoices/recurring/${planId}`,
  });

  return {
    ok: true,
    activated: true,
    planId,
    xeroRepeatingInvoiceId: primaryRiId,
    startDate,
  };
}
