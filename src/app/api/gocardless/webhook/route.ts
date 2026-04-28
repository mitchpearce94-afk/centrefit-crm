import { NextRequest, NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { verifyGoCardlessSignature } from "@/lib/gocardless/webhook-verify";
import { getMandate, getBillingRequest } from "@/lib/gocardless/client";
import { getAuthedClient } from "@/lib/xero/client";
import { findOrCreateContact } from "@/lib/xero/contacts";
import { createRepeatingInvoice, type PlanFrequency } from "@/lib/xero/repeating-invoices";

/**
 * GoCardless webhook receiver.
 *
 * Auth: HMAC-SHA256 of the raw body using GOCARDLESS_WEBHOOK_SECRET as the
 * shared key, hex-encoded in the `Webhook-Signature` header.
 *
 * Events we care about (resource_type=mandates):
 *   - active     → mandate is verified by the bank, ready to debit. Create
 *                  the Xero RepeatingInvoice for the linked plan and flip
 *                  status=`active`.
 *   - failed     → bank rejected. Status=`failed`. No Xero side-effect.
 *   - cancelled  → mandate cancelled by customer or admin. Status=`cancelled`.
 *
 * Everything else is silently logged + ignored. GC requires <5s response.
 */

interface GcEvent {
  id: string;
  resource_type: string;
  action: string;
  created_at: string;
  details: { cause?: string; description?: string };
  links: {
    mandate?: string;
    customer?: string;
    billing_request?: string;
  };
}

interface GcWebhookPayload {
  events: GcEvent[];
}

export async function POST(req: NextRequest) {
  const secret = process.env.GOCARDLESS_WEBHOOK_SECRET;
  if (!secret) {
    console.error("[gc-webhook] GOCARDLESS_WEBHOOK_SECRET not set");
    return new NextResponse(null, { status: 500 });
  }

  const raw = await req.text();
  const sig = req.headers.get("webhook-signature");

  if (!verifyGoCardlessSignature(raw, sig, secret)) {
    return new NextResponse(null, { status: 498 }); // GC's preferred status for invalid sig
  }

  let payload: GcWebhookPayload;
  try {
    payload = JSON.parse(raw);
  } catch {
    return new NextResponse(null, { status: 400 });
  }

  const supabase = createServiceRoleClient();

  for (const event of payload.events ?? []) {
    try {
      if (event.resource_type === "billing_requests") {
        await handleBillingRequestEvent(supabase, event);
      } else if (event.resource_type === "mandates") {
        await handleMandateEvent(supabase, event);
      }
    } catch (err) {
      console.error(`[gc-webhook] event ${event.id} failed:`, err);
    }
  }

  return new NextResponse(null, { status: 200 });
}

/**
 * Billing Request lifecycle. Centrefit's flow uses BRs (not redirect_flows)
 * so we can lock customer details on the GC-hosted form. The fulfilled event
 * fires once the customer signs and GC has provisioned the mandate — at
 * which point we extract the customer + mandate IDs and persist them on
 * the plan. The mandate.active event still fires later (separately) once
 * the bank verifies the mandate, and that's what triggers Xero RI creation.
 */
async function handleBillingRequestEvent(
  supabase: ReturnType<typeof createServiceRoleClient>,
  event: GcEvent,
) {
  const billingRequestId = event.links.billing_request;
  if (!billingRequestId) return;

  const { data: plan } = await supabase
    .from("recurring_plans")
    .select("id, status, gc_customer_id, gc_mandate_id")
    .eq("gc_billing_request_id", billingRequestId)
    .maybeSingle();
  if (!plan) return;

  // We only care about transitions that surface customer + mandate IDs.
  if (event.action !== "fulfilled" && event.action !== "ready_to_fulfil") return;

  // Re-fetch the BR for authoritative linkage data.
  const br = await getBillingRequest(billingRequestId);
  const customerId = br.links.customer ?? null;
  const mandateId = br.links.mandate_request_mandate ?? null;
  if (!customerId && !mandateId) return;

  await supabase
    .from("recurring_plans")
    .update({
      gc_customer_id: customerId,
      gc_mandate_id: mandateId,
    })
    .eq("id", plan.id);
}

async function handleMandateEvent(
  supabase: ReturnType<typeof createServiceRoleClient>,
  event: GcEvent,
) {
  const mandateId = event.links.mandate;
  if (!mandateId) return;

  // Look up the plan by GC linkage. Some mandate events arrive before our
  // create-plan flow has finished writing gc_mandate_id, so we also fall
  // back to gc_customer_id (which we set as part of customer creation).
  const customerId = event.links.customer;
  let { data: plan } = await supabase
    .from("recurring_plans")
    .select("id, customer_id, site_id, status, xero_contact_id, xero_repeating_invoice_id, gc_customer_id, gc_mandate_id")
    .eq("gc_mandate_id", mandateId)
    .maybeSingle();

  if (!plan && customerId) {
    const fallback = await supabase
      .from("recurring_plans")
      .select("id, customer_id, site_id, status, xero_contact_id, xero_repeating_invoice_id, gc_customer_id, gc_mandate_id")
      .eq("gc_customer_id", customerId)
      .is("gc_mandate_id", null)
      .maybeSingle();
    plan = fallback.data;
  }
  if (!plan) return;

  // Always cache the mandate id back on the plan so future events resolve quickly.
  if (!plan.gc_mandate_id) {
    await supabase.from("recurring_plans").update({ gc_mandate_id: mandateId }).eq("id", plan.id);
  }

  // Mandate state transitions per GC: active | failed | cancelled | expired ... etc
  switch (event.action) {
    case "active":
    case "submitted":
      // Confirm the mandate is genuinely active (sometimes 'submitted' fires before 'active').
      // Re-fetch the mandate to be sure before we flip the plan.
      try {
        const m = await getMandate(mandateId);
        if (m.status === "active") {
          await activatePlan(supabase, plan.id);
        }
      } catch (err) {
        console.error(`[gc-webhook] failed to fetch mandate ${mandateId}:`, err);
      }
      break;

    case "failed":
    case "expired":
    case "cancelled":
      await supabase
        .from("recurring_plans")
        .update({
          status: event.action === "cancelled" ? "cancelled" : "failed",
          notes: `${event.action} via GC: ${event.details.description ?? event.details.cause ?? ""}`.slice(0, 1000),
        })
        .eq("id", plan.id);
      break;

    default:
      // Unhandled (e.g. transferred, reinstated) — log only.
      console.log(`[gc-webhook] unhandled action ${event.action} for mandate ${mandateId}`);
  }
}

/**
 * Mandate is active. Create the Xero RepeatingInvoice template (if not
 * already created — idempotent on plan.xero_repeating_invoice_id) and
 * flip plan status to active.
 */
async function activatePlan(
  supabase: ReturnType<typeof createServiceRoleClient>,
  planId: string,
) {
  const { data: plan } = await supabase
    .from("recurring_plans")
    .select(`
      id, status, customer_id, site_id, gc_mandate_id, xero_repeating_invoice_id,
      customers(id, name, abn, xero_contact_id, customer_contacts(name, email, phone, is_primary)),
      customer_sites(name, address, suburb, state, postcode)
    `)
    .eq("id", planId)
    .single();
  if (!plan) return;

  // Already activated — idempotent.
  if (plan.status === "active" && plan.xero_repeating_invoice_id) return;

  // Pull plan items.
  const { data: items } = await supabase
    .from("recurring_plan_items")
    .select("service_code, service_name, description, price_inc_gst, frequency, quantity")
    .eq("recurring_plan_id", planId);
  if (!items || items.length === 0) return;

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
  if (!customer) throw new Error("Plan has no customer");
  const site = Array.isArray(plan.customer_sites) ? plan.customer_sites[0] : plan.customer_sites;
  const primary =
    customer.customer_contacts?.find((c: { is_primary: boolean }) => c.is_primary) ??
    customer.customer_contacts?.[0];

  const { client: xero, conn } = await getAuthedClient(supabase);

  // Resolve the Xero contact for this site/customer. We pass the plan's
  // primary contact + abn through findOrCreateContact, which deduplicates
  // by xero_contact_id if already linked.
  const xeroContactId = await findOrCreateContact(supabase, xero, conn.tenant_id, {
    id: customer.id,
    name: site?.name ? `${customer.name} — ${site.name}` : customer.name,
    xero_contact_id: customer.xero_contact_id,
    email: primary?.email ?? null,
    phone: primary?.phone ?? null,
    abn: customer.abn ?? null,
  });

  // First invoice fires today (auto-debit kicks in via the linked mandate).
  const today = new Date();
  const todayStr = today.toISOString().slice(0, 10);

  let monthlyRiId: string | null = null;
  let yearlyRiId: string | null = null;

  for (const [frequency, group] of byFreq.entries()) {
    const ri = await createRepeatingInvoice({
      xero,
      tenantId: conn.tenant_id,
      xeroContactId,
      reference: `Plan ${plan.id.slice(0, 8)}`,
      frequency,
      nextScheduledDate: todayStr,
      dueDays: 7,
      childStatus: "AUTHORISED",
      lineItems: group.map((it) => ({
        description: it.description ?? it.service_name,
        quantity: it.quantity,
        unitAmount: Number(it.price_inc_gst),
      })),
    });
    if (frequency === "monthly") monthlyRiId = ri.repeatingInvoiceID;
    if (frequency === "yearly") yearlyRiId = ri.repeatingInvoiceID;
  }

  await supabase
    .from("recurring_plans")
    .update({
      status: "active",
      xero_contact_id: xeroContactId,
      xero_repeating_invoice_id: monthlyRiId ?? yearlyRiId,
      next_invoice_date: todayStr,
      notes: yearlyRiId && monthlyRiId
        ? `Yearly RepeatingInvoice ID: ${yearlyRiId}` // monthlyRiId is the primary
        : null,
    })
    .eq("id", planId);
}
