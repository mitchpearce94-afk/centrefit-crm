import crypto from "node:crypto";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { getAuthedClient } from "@/lib/xero/client";
import { findOrCreateContact } from "@/lib/xero/contacts";
import { createRepeatingInvoice, type PlanFrequency } from "@/lib/xero/repeating-invoices";
import { createSubscription, getMandate } from "@/lib/gocardless/client";
import { enqueueNotification } from "@/lib/notifications/enqueue";

type ServiceClient = ReturnType<typeof createServiceRoleClient>;

/**
 * Persist an activation failure so the UI, the retry cron, and Mitchell's
 * notification bell all see it. Called from every failure path in
 * activatePlanInner + the outer catch. Best-effort — if the row update
 * itself fails we still emit a console.error as a last-resort breadcrumb,
 * but every code path that reaches here already has a notification on
 * its way too.
 */
async function recordActivationFailure(
  supabase: ServiceClient,
  planId: string,
  reason: string,
): Promise<void> {
  try {
    // Pull the previous attempt count so we can increment, plus enough
    // customer/site context for a useful notification body.
    const { data: plan } = await supabase
      .from("recurring_plans")
      .select(
        "id, activation_attempts, customer_id, site_id, customers(name), customer_sites(name)",
      )
      .eq("id", planId)
      .single();
    const attempts = (plan?.activation_attempts ?? 0) + 1;
    await supabase
      .from("recurring_plans")
      .update({
        activation_error: reason,
        activation_attempts: attempts,
        last_activation_attempt_at: new Date().toISOString(),
      })
      .eq("id", planId);

    const customer = Array.isArray(plan?.customers) ? plan?.customers[0] : plan?.customers;
    const site = Array.isArray(plan?.customer_sites) ? plan?.customer_sites[0] : plan?.customer_sites;
    const who =
      site?.name && customer?.name
        ? `${customer.name} — ${site.name}`
        : customer?.name ?? "Unknown customer";
    await enqueueNotification({
      supabase,
      typeCode: "recurring_plan.activation_failed",
      refType: "recurring_plan",
      refId: planId,
      audience: { allActive: true },
      title: `Activation failed: ${who}`,
      body: `Attempt ${attempts} — ${reason}. Auto-retry will run within 15 min, or hit Retry on the plan page.`,
      href: `/invoices/recurring/${planId}`,
    });
  } catch (err) {
    // Never let the failure-recorder itself throw — it would mask the real
    // error from the caller. Log so the breadcrumb survives if everything
    // upstream collapses.
    console.error(`[activatePlan] recordActivationFailure failed for ${planId}:`, err);
  }
}


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
  // Outer try/catch so every failure path goes through the same
  // record-error + notify pipeline. Without this, a thrown Xero API error
  // (rate limit, token refresh, RI creation) silently kills the plan in
  // pending_mandate with nothing surfaced — Ben Gunning / Woodend 2026-05-25.
  try {
    return await activatePlanInner(supabase, planId);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await recordActivationFailure(supabase, planId, `threw: ${message}`);
    return { ok: false, reason: `activation_threw: ${message}`, planId };
  }
}

async function activatePlanInner(
  supabase: ServiceClient,
  planId: string,
): Promise<ActivatePlanResult> {
  const { data: plan } = await supabase
    .from("recurring_plans")
    .select(`
      id, status, customer_id, site_id, gc_mandate_id, first_invoice_date, yearly_first_invoice_date,
      xero_repeating_invoice_id, xero_repeating_invoice_secondary_id,
      gc_subscription_id, gc_subscription_secondary_id,
      customers(id, name, abn, xero_contact_id, billing_email, customer_contacts(name, email, phone, is_primary)),
      customer_sites(name, address, suburb, state, postcode, xero_contact_id, billing_email)
    `)
    .eq("id", planId)
    .single();
  if (!plan) {
    await recordActivationFailure(supabase, planId, "plan_not_found");
    return { ok: false, reason: "plan_not_found", planId };
  }

  // Branding-theme selection: NBN-derived plans get the Communications DD
  // theme; everything else gets the Solutions DD theme. NBN-derivation is
  // identified by an nbn_enquiries row pointing at this plan.
  const { count: nbnLinkCount } = await supabase
    .from("nbn_enquiries")
    .select("id", { count: "exact", head: true })
    .eq("recurring_plan_id", planId);
  const isNbnPlan = (nbnLinkCount ?? 0) > 0;
  const brandingThemeID = isNbnPlan
    ? process.env.XERO_BRANDING_THEME_COMMUNICATIONS_DD_ID
    : process.env.XERO_BRANDING_THEME_SOLUTIONS_DD_ID;
  if (!brandingThemeID) {
    const reason = isNbnPlan
      ? "XERO_BRANDING_THEME_COMMUNICATIONS_DD_ID env var not set"
      : "XERO_BRANDING_THEME_SOLUTIONS_DD_ID env var not set";
    await recordActivationFailure(supabase, planId, reason);
    return { ok: false, reason, planId };
  }

  // Fully activated — Xero RI(s) AND a GC subscription both exist. Idempotent
  // no-op. A plan that's active but has no subscription (activated before
  // subscriptions existed) deliberately falls through to backfill one below.
  if (plan.status === "active" && plan.xero_repeating_invoice_id && plan.gc_subscription_id) {
    return { ok: true, skipped: "already_active", planId };
  }

  // Pull plan items.
  const { data: items } = await supabase
    .from("recurring_plan_items")
    .select("service_code, service_name, description, price_inc_gst, frequency, account_code, quantity")
    .eq("recurring_plan_id", planId);
  if (!items || items.length === 0) {
    await recordActivationFailure(supabase, planId, "no_plan_items");
    return { ok: false, reason: "no_plan_items", planId };
  }

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
  if (!customer) {
    await recordActivationFailure(supabase, planId, "no_customer");
    return { ok: false, reason: "no_customer", planId };
  }
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
      billing_email: (customer as { billing_email?: string | null }).billing_email ?? null,
      phone: primary?.phone ?? null,
      abn: customer.abn ?? null,
    },
    plan.site_id && site
      ? {
          id: plan.site_id,
          name: site.name,
          xero_contact_id: (site as { xero_contact_id?: string | null }).xero_contact_id ?? null,
          billing_email: (site as { billing_email?: string | null }).billing_email ?? null,
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

  // Per-cadence first-invoice date. Monthly uses first_invoice_date (floored
  // to today as `startDate`). Yearly bills on its own yearly_first_invoice_date
  // when set and not in the past (e.g. a MyAlarm yearly sub migrated mid-cycle),
  // else falls back to the monthly start. This MUST drive both the Xero
  // RepeatingInvoice and the GC subscription. Before 2026-06-30 only the GC sub
  // honoured the yearly date, so the Xero yearly invoice fired on the monthly
  // date — Estella's yearly was set to 9/2/27 but Xero created it for 19/7/26.
  const cadenceStartDate = (frequency: PlanFrequency): string =>
    frequency === "yearly" && plan.yearly_first_invoice_date && plan.yearly_first_invoice_date >= todayStr
      ? plan.yearly_first_invoice_date
      : startDate;

  // ── Xero RepeatingInvoice(s) ──
  // Reuse if already created (e.g. backfilling a subscription onto a plan
  // that was activated before subscriptions existed), otherwise create one
  // per cadence and persist immediately so a later failure can't make a
  // retry duplicate the templates.
  let primaryRiId: string | null = plan.xero_repeating_invoice_id ?? null;
  let secondaryRiId: string | null = plan.xero_repeating_invoice_secondary_id ?? null;

  if (!primaryRiId) {
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
      startDate: cadenceStartDate(frequency),
      dueDays: 7,
      // Mitchell's 2026-05-27 call: new plans go live AUTHORISED + auto-send
      // so the customer gets their first invoice automatically on the
      // chosen first_invoice_date. The 2026-05-11 duplicate-send incident
      // is mitigated by the idempotency key + activation safety net
      // (recordActivationFailure + retry cron), so the "manual approve"
      // gate is no longer needed.
      childStatus: "AUTHORISED",
      brandingThemeID,
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
  primaryRiId = monthlyRiId ?? yearlyRiId;
  secondaryRiId = monthlyRiId && yearlyRiId ? yearlyRiId : null;

  if (!primaryRiId) {
    await recordActivationFailure(supabase, planId, "no_ri_created");
    return { ok: false, reason: "no_ri_created", planId };
  }

  // Persist RI ids straight away so a failure in the subscription step below
  // doesn't cause a retry to create duplicate Xero templates.
  await supabase
    .from("recurring_plans")
    .update({
      xero_repeating_invoice_id: primaryRiId,
      xero_repeating_invoice_secondary_id: secondaryRiId,
    })
    .eq("id", planId);
  }

  // ── GoCardless subscription(s) ──
  // THIS is what actually collects the money: a subscription per cadence
  // against the mandate. GoCardless then debits the customer on schedule.
  // Without it the mandate + Xero invoice exist but nothing is ever charged.
  // Stable idempotency key per (plan, cadence) so retries — or a backfill of
  // an already-active plan — never create duplicate billing schedules.
  const mandateId = plan.gc_mandate_id;
  if (!mandateId) {
    await recordActivationFailure(supabase, planId, "no_gc_mandate — cannot create subscription");
    return { ok: false, reason: "no_gc_mandate", planId };
  }

  let monthlySubId: string | null = plan.gc_subscription_id ?? null;
  let yearlySubId: string | null = plan.gc_subscription_secondary_id ?? null;

  // A subscription start_date earlier than the mandate's next_possible_charge_date
  // is rejected by GoCardless with a 422. Fresh AU BECS mandates sit a few
  // business days out, so floor every subscription start to that date. ISO
  // YYYY-MM-DD strings compare correctly lexicographically.
  let earliestCharge: string | null = null;
  try {
    earliestCharge = (await getMandate(mandateId)).next_possible_charge_date;
  } catch {
    // Non-fatal: if we can't read the mandate, fall through with the plan
    // dates. GoCardless will still reject an impossible date and the retry
    // cron will pick it up — same as before this guard existed.
  }
  const floorToCharge = (d: string): string =>
    earliestCharge && earliestCharge > d ? earliestCharge : d;

  for (const [frequency, group] of byFreq.entries()) {
    if (frequency === "monthly" && monthlySubId) continue;
    if (frequency === "yearly" && yearlySubId) continue;

    const amountCents = Math.round(
      group.reduce((sum, it) => sum + Number(it.price_inc_gst) * (it.quantity ?? 1), 0) * 100,
    );
    if (amountCents <= 0) continue;

    // Yearly cadence can bill on its own date (e.g. a MyAlarm yearly sub
    // migrated in mid-cycle); monthly uses the plan start date. Either way the
    // start can't precede the mandate's next possible charge date.
    const subStart = floorToCharge(cadenceStartDate(frequency));

    const sub = await createSubscription(
      {
        amount: amountCents,
        currency: "AUD",
        interval_unit: frequency === "yearly" ? "yearly" : "monthly",
        start_date: subStart,
        name: site?.name ? `${site.name} (${frequency})` : `${customer.name} (${frequency})`,
        metadata: { plan_id: plan.id, cadence: frequency },
        links: { mandate: mandateId },
      },
      `crm-sub-${plan.id.slice(0, 8)}-${frequency}`,
    );
    if (frequency === "monthly") monthlySubId = sub.id;
    if (frequency === "yearly") yearlySubId = sub.id;
  }

  const primarySubId = monthlySubId ?? yearlySubId;
  const secondarySubId = monthlySubId && yearlySubId ? yearlySubId : null;
  if (!primarySubId) {
    await recordActivationFailure(supabase, planId, "no_gc_subscription_created");
    return { ok: false, reason: "no_gc_subscription_created", planId };
  }

  // Successful activation — clear any prior error breadcrumb and stamp the
  // success state. activation_attempts intentionally keeps its history so we
  // can spot plans that flapped.
  await supabase
    .from("recurring_plans")
    .update({
      status: "active",
      xero_contact_id: xeroContactId,
      xero_repeating_invoice_id: primaryRiId,
      xero_repeating_invoice_secondary_id: secondaryRiId,
      gc_subscription_id: primarySubId,
      gc_subscription_secondary_id: secondarySubId,
      next_invoice_date: startDate,
      activation_error: null,
      last_activation_attempt_at: new Date().toISOString(),
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
