import "server-only";
import {
  createBillingRequest,
  createBillingRequestFlow,
  collectCustomerDetails,
  getBillingRequest,
  getMandate,
  getSubscription,
  createSubscription,
  cancelSubscription,
} from "@/lib/gocardless/client";
import { aliasEmail } from "@/lib/recurring/alias";
import { sendMandateSignupEmail, type MandateLink } from "@/lib/emails/recurring-mandate-signup";
import { enqueueNotification } from "@/lib/notifications/enqueue";
import type { createServiceRoleClient } from "@/lib/supabase/service";

type ServiceClient = ReturnType<typeof createServiceRoleClient>;

/**
 * Site-first D4: automated GC re-mandate on owner change.
 *
 * The plan's mandate is signed against the PREVIOUS owner's bank account and
 * cannot be inherited, so a sold site needs the NEW owner to sign their own
 * mandate. Until they do, the old subscriptions keep collecting from the old
 * owner (deliberate — no revenue gap, and settlement between the parties is
 * their sale-contract business, not ours).
 *
 * startRemandate  — creates a Billing Request for the site's CURRENT backing
 *                   customer (the new owner) with `remandate_plan_id` metadata
 *                   and emails them the signup link. Re-calling while a signup
 *                   is pending re-sends the SAME link (no duplicate BRs).
 * completeRemandate — driven by the BR-fulfilled webhook: mirrors every active
 *                   subscription (including imported legacy ones, quarterly
 *                   `interval=3` and all) onto the new mandate starting at each
 *                   sub's next scheduled charge date, cancels the old subs,
 *                   and re-points the plan at the new backing customer. The
 *                   old MANDATE is left alone — multi-site owners keep using
 *                   it for their other sites, and a mandate with no
 *                   subscriptions charges nothing.
 *
 * Xero deliberately untouched: the Xero contact IS the site (D3), so the
 * RepeatingInvoice keeps firing against the same contact; change-owner
 * already mirrors the new owner's billing email onto the site.
 */

export type StartRemandateResult =
  | { ok: true; planId: string; signupUrl: string; emailedTo: string | null; resent: boolean }
  | { ok: false; planId: string; reason: string };

export async function startRemandate(
  supabase: ServiceClient,
  planId: string,
  opts: { appUrl: string; sendEmail?: boolean },
): Promise<StartRemandateResult> {
  try {
    return await startRemandateInner(supabase, planId, opts);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    return { ok: false, planId, reason };
  }
}

async function startRemandateInner(
  supabase: ServiceClient,
  planId: string,
  opts: { appUrl: string; sendEmail?: boolean },
): Promise<StartRemandateResult> {
  const sendEmail = opts.sendEmail ?? true;

  const { data: plan } = await supabase
    .from("recurring_plans")
    .select(`
      id, status, site_id, customer_id,
      remandate_billing_request_id, remandate_signup_url, remandate_completed_at,
      customer_sites(id, name, customer_id)
    `)
    .eq("id", planId)
    .maybeSingle();
  if (!plan) return { ok: false, planId, reason: "plan_not_found" };
  if (plan.status !== "active" && plan.status !== "paused") {
    return { ok: false, planId, reason: `plan status is ${plan.status} — only active/paused plans can re-mandate` };
  }
  const site = Array.isArray(plan.customer_sites) ? plan.customer_sites[0] : plan.customer_sites;
  if (!site) return { ok: false, planId, reason: "plan has no site — re-mandate is a site-sale flow" };
  if (site.customer_id === plan.customer_id) {
    return { ok: false, planId, reason: "site owner has not changed — plan already belongs to the site's backing customer" };
  }

  // The NEW owner = the site's current backing customer (change-owner already
  // re-pointed the site). Owner changed twice before signup? This always
  // targets whoever owns the site right now.
  const { data: newOwner } = await supabase
    .from("customers")
    .select("id, name, billing_email, customer_contacts(name, email, is_primary)")
    .eq("id", site.customer_id)
    .maybeSingle();
  if (!newOwner) return { ok: false, planId, reason: "new backing customer not found" };
  const primary =
    newOwner.customer_contacts?.find((c: { is_primary: boolean }) => c.is_primary) ??
    newOwner.customer_contacts?.[0];
  const ownerEmail = newOwner.billing_email || primary?.email || null;
  if (!ownerEmail) {
    return { ok: false, planId, reason: "new owner has no billing or contact email — add one on the Owner tab first" };
  }

  // Pending signup already out there → re-send the same link, don't stack BRs.
  if (plan.remandate_billing_request_id && plan.remandate_signup_url && !plan.remandate_completed_at) {
    if (sendEmail) {
      await sendMandateSignupEmail({
        to: ownerEmail,
        customerName: primary?.name ?? newOwner.name,
        links: [await buildMandateLink(supabase, planId, site.name, plan.remandate_signup_url)],
      });
    }
    await supabase
      .from("recurring_plans")
      .update({ remandate_requested_at: new Date().toISOString() })
      .eq("id", planId);
    return { ok: true, planId, signupUrl: plan.remandate_signup_url, emailedTo: sendEmail ? ownerEmail : null, resent: true };
  }

  const alias = aliasEmail(ownerEmail, site.name, plan.id.slice(0, 6));
  const br = await createBillingRequest(
    {
      mandate_request: {
        scheme: "becs",
        currency: "AUD",
        description: `Centrefit recurring billing — ${site.name}`,
      },
      metadata: {
        remandate_plan_id: plan.id,
        site_label: site.name.slice(0, 50),
      },
    },
    // New-owner id in the key: a SECOND sale of the same site mints a fresh BR
    // instead of replaying the previous owner's.
    `replan-${plan.id}-${site.customer_id.slice(0, 8)}-br`,
  );

  const givenName = primary?.name?.split(/\s+/)[0];
  const familyName = primary?.name?.split(/\s+/).slice(1).join(" ");
  await collectCustomerDetails(
    br.id,
    {
      customer: {
        email: alias,
        company_name: newOwner.name,
        ...(givenName ? { given_name: givenName } : {}),
        ...(familyName ? { family_name: familyName } : {}),
      },
      customer_billing_detail: { country_code: "AU" },
    },
    `replan-${plan.id}-${site.customer_id.slice(0, 8)}-ccd`,
  );

  const flow = await createBillingRequestFlow(
    {
      redirect_uri: `${opts.appUrl}/recurring-thanks?plan=${plan.id}&remandate=1`,
      links: { billing_request: br.id },
      show_redirect_buttons: true,
      lock_customer_details: true,
    },
    `replan-${plan.id}-${site.customer_id.slice(0, 8)}-brf`,
  );

  await supabase
    .from("recurring_plans")
    .update({
      remandate_billing_request_id: br.id,
      remandate_signup_url: flow.authorisation_url,
      remandate_requested_at: new Date().toISOString(),
      remandate_completed_at: null,
      alias_email: alias,
    })
    .eq("id", planId);

  if (sendEmail) {
    await sendMandateSignupEmail({
      to: ownerEmail,
      customerName: primary?.name ?? newOwner.name,
      links: [await buildMandateLink(supabase, planId, site.name, flow.authorisation_url)],
    });
  }

  return { ok: true, planId, signupUrl: flow.authorisation_url, emailedTo: sendEmail ? ownerEmail : null, resent: false };
}

/**
 * Service + total summary for the signup email. Wizard-created plans have
 * items; imported legacy plans describe themselves via their GC subscription
 * mirror rows instead.
 */
async function buildMandateLink(
  supabase: ServiceClient,
  planId: string,
  siteLabel: string,
  url: string,
): Promise<MandateLink> {
  const { data: items } = await supabase
    .from("recurring_plan_items")
    .select("service_name, price_inc_gst, frequency, quantity")
    .eq("recurring_plan_id", planId);

  if (items && items.length > 0) {
    const monthly = items.filter((r) => r.frequency === "monthly")
      .reduce((sum, r) => sum + Number(r.price_inc_gst) * (r.quantity ?? 1), 0);
    const yearly = items.filter((r) => r.frequency === "yearly")
      .reduce((sum, r) => sum + Number(r.price_inc_gst) * (r.quantity ?? 1), 0);
    const parts: string[] = [];
    if (monthly > 0) parts.push(`$${monthly.toFixed(2)}/month`);
    if (yearly > 0) parts.push(`$${yearly.toFixed(2)}/year`);
    return {
      siteLabel,
      url,
      serviceSummary: items
        .map((r) => ((r.quantity ?? 1) > 1 ? `${r.service_name} × ${r.quantity}` : r.service_name))
        .join(" • "),
      recurringSummary: `Recurring total: ${parts.join(" + ")} (incl. GST)`,
    };
  }

  const { data: subs } = await supabase
    .from("recurring_plan_gc_subscriptions")
    .select("name, amount_cents, interval_unit, interval")
    .eq("plan_id", planId)
    .eq("gc_status", "active");
  const label = (s: { interval_unit: string; interval: number | null }) => {
    const n = s.interval ?? 1;
    if (n === 1) return s.interval_unit === "yearly" ? "year" : s.interval_unit === "weekly" ? "week" : "month";
    return `${n} ${s.interval_unit === "yearly" ? "years" : s.interval_unit === "weekly" ? "weeks" : "months"}`;
  };
  return {
    siteLabel,
    url,
    serviceSummary: (subs ?? []).map((s) => s.name).join(" • ") || "Recurring services",
    recurringSummary: (subs ?? [])
      .map((s) => `$${(s.amount_cents / 100).toFixed(2)} every ${label(s)}`)
      .join(" + ") || "Existing billing continues on the same schedule",
  };
}

export type CompleteRemandateResult =
  | { ok: true; planId: string; skipped?: "already_completed"; swapped?: number; warnings?: string[] }
  | { ok: false; planId: string; reason: string };

export async function completeRemandate(
  supabase: ServiceClient,
  planId: string,
  billingRequestId: string,
): Promise<CompleteRemandateResult> {
  try {
    return await completeRemandateInner(supabase, planId, billingRequestId);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    await notifyRemandateFailure(supabase, planId, reason);
    return { ok: false, planId, reason };
  }
}

async function completeRemandateInner(
  supabase: ServiceClient,
  planId: string,
  billingRequestId: string,
): Promise<CompleteRemandateResult> {
  const { data: plan } = await supabase
    .from("recurring_plans")
    .select(`
      id, status, site_id, customer_id,
      gc_subscription_id, gc_subscription_secondary_id,
      remandate_billing_request_id, remandate_completed_at,
      customer_sites(id, name, customer_id)
    `)
    .eq("id", planId)
    .maybeSingle();
  if (!plan) return { ok: false, planId, reason: "plan_not_found" };
  if (plan.remandate_billing_request_id !== billingRequestId) {
    return { ok: false, planId, reason: "billing request does not match the plan's pending re-mandate" };
  }
  // fulfilled can fire more than once (plus ready_to_fulfil) — idempotent.
  if (plan.remandate_completed_at) return { ok: true, planId, skipped: "already_completed" };
  const site = Array.isArray(plan.customer_sites) ? plan.customer_sites[0] : plan.customer_sites;
  if (!site) return { ok: false, planId, reason: "plan has no site" };

  const br = await getBillingRequest(billingRequestId);
  const newMandateId = br.links.mandate_request_mandate ?? null;
  const newGcCustomerId = br.links.customer ?? null;
  if (!newMandateId) return { ok: false, planId, reason: "fulfilled billing request has no mandate" };

  // New-mandate floor: a fresh AU BECS mandate can't be charged for a few
  // business days — GC 422s a subscription that starts before this date.
  let earliestCharge: string | null = null;
  try {
    earliestCharge = (await getMandate(newMandateId)).next_possible_charge_date;
  } catch { /* non-fatal — GC will reject an impossible date and we surface it */ }
  const floorToCharge = (d: string): string => (earliestCharge && earliestCharge > d ? earliestCharge : d);

  // Everything currently charging this plan: the primary/secondary columns
  // plus the imported-legacy mirror table (the 2026-06-10 GC import keeps its
  // subs there; the old cancel-flow bug was forgetting them).
  const oldSubIds = new Set<string>();
  if (plan.gc_subscription_id) oldSubIds.add(plan.gc_subscription_id);
  if (plan.gc_subscription_secondary_id) oldSubIds.add(plan.gc_subscription_secondary_id);
  const { data: legacyRows } = await supabase
    .from("recurring_plan_gc_subscriptions")
    .select("gc_subscription_id, gc_status")
    .eq("plan_id", planId);
  for (const r of legacyRows ?? []) {
    if (r.gc_status === "active" && r.gc_subscription_id) oldSubIds.add(r.gc_subscription_id);
  }
  if (oldSubIds.size === 0) return { ok: false, planId, reason: "no active subscriptions found to migrate" };

  const warnings: string[] = [];
  const swaps: Array<{ oldId: string; newId: string; amountCents: number; intervalUnit: string; interval: number; dayOfMonth: number | null; startDate: string; name: string | null }> = [];

  // 1. Mirror each old sub onto the new mandate, cutting over at the old
  //    sub's next scheduled charge so the customer is never double-charged
  //    and never skips a period.
  for (const oldId of oldSubIds) {
    let old;
    try {
      old = await getSubscription(oldId);
    } catch (err) {
      warnings.push(`old sub ${oldId.slice(0, 10)} unreadable: ${err instanceof Error ? err.message : String(err)}`);
      continue;
    }
    if (old.status !== "active" && old.status !== "paused") {
      warnings.push(`old sub ${oldId.slice(0, 10)} is ${old.status} — not migrated`);
      continue;
    }
    const nextCharge = old.upcoming_payments?.[0]?.charge_date ?? earliestCharge;
    if (!nextCharge) {
      warnings.push(`old sub ${oldId.slice(0, 10)} has no upcoming charge and mandate floor unknown — not migrated`);
      continue;
    }
    const startDate = floorToCharge(nextCharge);
    const created = await createSubscription(
      {
        amount: old.amount,
        currency: old.currency,
        interval_unit: old.interval_unit as "weekly" | "monthly" | "yearly",
        ...(old.interval && old.interval !== 1 ? { interval: old.interval } : {}),
        start_date: startDate,
        name: old.name ?? site.name,
        metadata: { plan_id: plan.id, remandate_from: oldId },
        links: { mandate: newMandateId },
      },
      // Old-sub id in the key — stable across webhook retries, unique across
      // successive re-mandates (each cancels its predecessors).
      `resub-${oldId}`,
    );
    swaps.push({
      oldId,
      newId: created.id,
      amountCents: old.amount,
      intervalUnit: old.interval_unit,
      interval: old.interval ?? 1,
      dayOfMonth: old.day_of_month ?? null,
      startDate,
      name: old.name,
    });
  }
  if (swaps.length === 0) {
    return { ok: false, planId, reason: `no subscriptions migrated (${warnings.join("; ") || "unknown"})` };
  }

  // 2. Stop the old owner's subs — only after their replacements exist.
  for (const s of swaps) {
    try {
      await cancelSubscription(s.oldId);
    } catch (err) {
      warnings.push(`old sub ${s.oldId.slice(0, 10)} cancel failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // 3. Re-point the plan at the new owner + new GC linkage. Primary/secondary
  //    map through the swap; a sub that wasn't in those columns (imported
  //    legacy) fills primary if it was empty.
  const mapped = new Map(swaps.map((s) => [s.oldId, s.newId]));
  const newPrimary =
    (plan.gc_subscription_id && mapped.get(plan.gc_subscription_id)) || swaps[0].newId;
  const newSecondary =
    (plan.gc_subscription_secondary_id && mapped.get(plan.gc_subscription_secondary_id)) || null;
  await supabase
    .from("recurring_plans")
    .update({
      customer_id: site.customer_id,
      gc_customer_id: newGcCustomerId,
      gc_mandate_id: newMandateId,
      gc_subscription_id: newPrimary,
      gc_subscription_secondary_id: newSecondary,
      remandate_completed_at: new Date().toISOString(),
    })
    .eq("id", planId);

  // 4. Keep the legacy mirror honest: old rows cancelled, new rows inserted.
  const oldMirrorIds = (legacyRows ?? []).filter((r) => r.gc_status === "active").map((r) => r.gc_subscription_id);
  if (oldMirrorIds.length > 0) {
    await supabase
      .from("recurring_plan_gc_subscriptions")
      .update({ gc_status: "cancelled", updated_at: new Date().toISOString() })
      .eq("plan_id", planId)
      .in("gc_subscription_id", oldMirrorIds);
    await supabase.from("recurring_plan_gc_subscriptions").insert(
      swaps
        .filter((s) => oldMirrorIds.includes(s.oldId))
        .map((s) => ({
          plan_id: planId,
          gc_subscription_id: s.newId,
          name: s.name ?? site.name,
          amount_cents: s.amountCents,
          currency: "AUD",
          interval_unit: s.intervalUnit,
          interval: s.interval,
          day_of_month: s.dayOfMonth,
          start_date: s.startDate,
          gc_status: "active",
          source: "remandate",
        })),
    );
  }

  const { data: newOwner } = await supabase
    .from("customers").select("name").eq("id", site.customer_id).maybeSingle();
  await enqueueNotification({
    supabase,
    typeCode: "recurring_plan.signup_completed",
    refType: "recurring_plan",
    refId: planId,
    audience: { allActive: true },
    title: `${newOwner?.name ?? "New owner"} signed — ${site.name} billing swapped`,
    body:
      `${swaps.length} subscription${swaps.length === 1 ? "" : "s"} moved to the new owner's mandate; old subscriptions cancelled.` +
      (warnings.length > 0 ? ` Warnings: ${warnings.join("; ")}`.slice(0, 500) : ""),
    href: `/invoices/recurring/${planId}`,
  });

  return { ok: true, planId, swapped: swaps.length, warnings: warnings.length > 0 ? warnings : undefined };
}

async function notifyRemandateFailure(supabase: ServiceClient, planId: string, reason: string) {
  try {
    await enqueueNotification({
      supabase,
      typeCode: "recurring_plan.activation_failed",
      refType: "recurring_plan",
      refId: planId,
      audience: { allActive: true },
      title: "Re-mandate swap failed",
      body: `${reason}. The old owner's subscriptions are still collecting — retry from the plan page or fix manually in GoCardless.`.slice(0, 500),
      href: `/invoices/recurring/${planId}`,
    });
  } catch (err) {
    console.error(`[remandate] failure notification failed for ${planId}:`, err);
  }
}
