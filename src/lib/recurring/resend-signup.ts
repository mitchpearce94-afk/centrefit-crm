import "server-only";
import crypto from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createBillingRequestFlow } from "@/lib/gocardless/client";
import { sendMandateSignupEmail } from "@/lib/emails/recurring-mandate-signup";
import { enqueueNotification } from "@/lib/notifications/enqueue";

/**
 * Re-send the mandate signup email for a plan stuck in pending_mandate.
 *
 * GoCardless Billing Request Flows expire (~7 days), so a resend NEVER
 * re-uses the stored link — it mints a fresh flow against the same billing
 * request and persists the new URL. The underlying billing request (and the
 * plan's alias-email routing baked into it) is unchanged, so a customer who
 * eventually clicks an OLD email that still works signs the same mandate.
 *
 * Used by the "Resend signup email" button on the plan page (reminder=false)
 * and the pending-mandate watchdog's auto-chase (reminder=true, which also
 * advances the reminder counter/cool-off).
 */

export interface ResendSignupResult {
  to: string;
  signupUrl: string;
}

interface PlanRow {
  id: string;
  status: string;
  gc_mandate_id: string | null;
  gc_billing_request_id: string | null;
  customers:
    | { name: string; customer_contacts: Array<{ email: string | null; is_primary: boolean }> }
    | Array<{ name: string; customer_contacts: Array<{ email: string | null; is_primary: boolean }> }>
    | null;
  customer_sites: { name: string } | Array<{ name: string }> | null;
  recurring_plan_items: Array<{
    service_name: string;
    price_inc_gst: number | string;
    frequency: string;
    quantity: number | null;
  }>;
}

export async function resendSignupEmail(
  supabase: SupabaseClient,
  planId: string,
  opts: { reminder: boolean },
): Promise<ResendSignupResult> {
  const { data } = await supabase
    .from("recurring_plans")
    .select(`
      id, status, gc_mandate_id, gc_billing_request_id,
      customers(name, customer_contacts(email, is_primary)),
      customer_sites(name),
      recurring_plan_items(service_name, price_inc_gst, frequency, quantity)
    `)
    .eq("id", planId)
    .maybeSingle();
  const plan = data as unknown as PlanRow | null;
  if (!plan) throw new Error("Plan not found");
  if (plan.status !== "pending_mandate") {
    throw new Error(`Plan is ${plan.status} — only pending_mandate plans can be re-sent`);
  }
  if (plan.gc_mandate_id) {
    throw new Error("Mandate already signed — activation is what's stuck, not the signup");
  }
  if (!plan.gc_billing_request_id) {
    throw new Error("Plan has no GoCardless billing request to re-link");
  }

  const customer = Array.isArray(plan.customers) ? plan.customers[0] : plan.customers;
  const site = Array.isArray(plan.customer_sites) ? plan.customer_sites[0] : plan.customer_sites;
  const siteLabel = site?.name ?? customer?.name ?? "your site";
  const primary =
    customer?.customer_contacts?.find((c) => c.is_primary && c.email) ??
    customer?.customer_contacts?.find((c) => !!c.email);
  if (!primary?.email) {
    throw new Error("Customer has no contact email to send the signup to");
  }

  const appUrl =
    process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") ?? "https://crm.centrefit.com.au";

  // Fresh flow every time — unique idempotency key per send, or GoCardless
  // would hand back the original (possibly expired) flow.
  const flow = await createBillingRequestFlow(
    {
      redirect_uri: `${appUrl}/recurring-thanks?plan=${plan.id}`,
      links: { billing_request: plan.gc_billing_request_id },
      show_redirect_buttons: true,
      lock_customer_details: true,
    },
    `plan-${plan.id}-brf-${crypto.randomUUID().slice(0, 8)}`,
  );
  const signupUrl = flow.authorisation_url;

  const items = plan.recurring_plan_items ?? [];
  const monthly = items.filter((r) => r.frequency === "monthly")
    .reduce((s, r) => s + Number(r.price_inc_gst) * (r.quantity ?? 1), 0);
  const yearly = items.filter((r) => r.frequency === "yearly")
    .reduce((s, r) => s + Number(r.price_inc_gst) * (r.quantity ?? 1), 0);
  const summaryParts: string[] = [];
  if (monthly > 0) summaryParts.push(`$${monthly.toFixed(2)}/month`);
  if (yearly > 0) summaryParts.push(`$${yearly.toFixed(2)}/year`);

  await sendMandateSignupEmail({
    to: primary.email,
    customerName: customer?.name ?? siteLabel,
    reminder: opts.reminder,
    links: [{
      siteLabel,
      url: signupUrl,
      serviceSummary: items
        .map((r) => (r.quantity ?? 1) > 1 ? `${r.service_name} × ${r.quantity}` : r.service_name)
        .join(" • "),
      recurringSummary: `Recurring total: ${summaryParts.join(" + ")} (incl. GST)`,
    }],
  });

  const now = new Date().toISOString();
  await supabase
    .from("recurring_plans")
    .update({
      signup_link_url: signupUrl,
      signup_emailed_at: now,
      // Manual resends also stamp this — a staff-sent email resets the
      // auto-chase cool-off so the customer isn't hit twice in one week.
      last_signup_reminder_at: now,
    })
    .eq("id", planId);
  if (opts.reminder) {
    // Counter advances only for automated reminders — manual resends from
    // the plan page don't burn the auto-chase budget.
    const { data: cur } = await supabase
      .from("recurring_plans")
      .select("signup_reminder_count")
      .eq("id", planId)
      .single();
    await supabase
      .from("recurring_plans")
      .update({ signup_reminder_count: (cur?.signup_reminder_count ?? 0) + 1 })
      .eq("id", planId);
  }

  await enqueueNotification({
    typeCode: "recurring_plan.signup_link_sent",
    refType: "recurring_plan",
    refId: planId,
    audience: { allActive: true },
    title: `Mandate signup ${opts.reminder ? "auto-reminder" : "re-sent"}: ${siteLabel}`,
    body: `Sent to ${primary.email} with a fresh GoCardless link.`,
    href: `/invoices/recurring/${planId}`,
  });

  return { to: primary.email, signupUrl };
}
