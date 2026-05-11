import { NextRequest, NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { verifyGoCardlessSignature } from "@/lib/gocardless/webhook-verify";
import { getMandate, getBillingRequest } from "@/lib/gocardless/client";
import { activatePlan } from "@/lib/recurring/activate-plan";
import { enqueueNotification } from "@/lib/notifications/enqueue";

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

  // AU BECS quirk: GC doesn't submit the mandate to the bank until the first
  // payment is created. So waiting for `mandate.active` to provision the Xero
  // RepeatingInvoice creates a dead-end (no RI → no payment → mandate never
  // activates). Fire activatePlan from BR.fulfilled instead — that's when we
  // have the IDs we need, regardless of mandate-state lifecycle.
  if (event.action === "fulfilled" && mandateId) {
    try {
      const result = await activatePlan(supabase, plan.id);
      if (!result.ok) {
        console.error(`[gc-webhook] activatePlan failed for plan ${plan.id}: ${result.reason}`);
      }
    } catch (err) {
      console.error(`[gc-webhook] activatePlan threw for plan ${plan.id}:`, err);
    }
  }
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
      await enqueueNotification({
        supabase,
        typeCode: "mandate.failed",
        refType: "recurring_plan",
        refId: plan.id,
        audience: { allActive: true },
        title: `Mandate ${event.action}`,
        body: `${event.details.description ?? event.details.cause ?? "GC reported a mandate state change."}`,
        href: `/invoices/recurring/${plan.id}`,
      });
      break;

    default:
      // Unhandled (e.g. transferred, reinstated) — log only.
      console.log(`[gc-webhook] unhandled action ${event.action} for mandate ${mandateId}`);
  }
}

