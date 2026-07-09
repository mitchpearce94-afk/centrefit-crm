import { NextRequest, NextResponse } from "next/server";
import crypto from "node:crypto";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { createSubscription, getMandate, GoCardlessApiError } from "@/lib/gocardless/client";
import { enqueueNotification } from "@/lib/notifications/enqueue";
import { mirrorServiceToXero } from "@/lib/recurring/mirror-service-invoice";

/**
 * Add a service to a plan that bills via existing GoCardless subscriptions
 * (imported legacy plans). Creates ONE new GC subscription for just the new
 * service against the plan's existing mandate — the delta — so nothing
 * already billing is touched and nothing double-charges.
 *
 * CUSTOMER-FACING MONEY ACTION: only ever called from the Add Service dialog
 * after staff explicitly confirm the charge. Never call this from automation.
 *
 * POST { planId, serviceName, serviceCode?, accountCode?, priceIncGst,
 *        frequency: "monthly"|"yearly", quantity?, startDate? (YYYY-MM-DD) }
 */
export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  let body: {
    planId?: string; serviceName?: string; serviceCode?: string; accountCode?: string;
    priceIncGst?: number; frequency?: string; quantity?: number; startDate?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { planId, serviceName, serviceCode, accountCode, startDate } = body;
  const priceIncGst = Number(body.priceIncGst);
  const quantity = Math.max(1, Math.trunc(Number(body.quantity ?? 1)));
  const frequency = body.frequency === "yearly" ? "yearly" : "monthly";
  if (!planId || !serviceName?.trim()) return NextResponse.json({ error: "planId and serviceName required" }, { status: 400 });
  if (!Number.isFinite(priceIncGst) || priceIncGst <= 0) return NextResponse.json({ error: "priceIncGst must be > 0" }, { status: 400 });

  const svc = createServiceRoleClient();
  const { data: plan } = await svc
    .from("recurring_plans")
    .select("id, status, gc_mandate_id, customer_id, site_id, customers(name), customer_sites(name)")
    .eq("id", planId)
    .maybeSingle();
  if (!plan) return NextResponse.json({ error: "Plan not found" }, { status: 404 });
  if (plan.status !== "active") return NextResponse.json({ error: `Plan is ${plan.status} — only active plans can take new services` }, { status: 400 });
  if (!plan.gc_mandate_id) return NextResponse.json({ error: "Plan has no GoCardless mandate" }, { status: 400 });

  try {
    // Clamp the first charge to what the mandate can actually do — GC 422s
    // on a start_date before next_possible_charge_date.
    const mandate = await getMandate(plan.gc_mandate_id);
    if (!["active", "pending_submission", "submitted"].includes(mandate.status)) {
      return NextResponse.json({ error: `Mandate is ${mandate.status} — cannot add a subscription` }, { status: 400 });
    }
    const earliest = mandate.next_possible_charge_date; // YYYY-MM-DD | null
    let chargeDate = startDate && /^\d{4}-\d{2}-\d{2}$/.test(startDate) ? startDate : earliest;
    if (earliest && (!chargeDate || chargeDate < earliest)) chargeDate = earliest;

    const amountCents = Math.round(priceIncGst * 100) * quantity;
    // Stable idempotency key per plan+service+date so a double-click can't
    // create two subscriptions.
    const idem = crypto.createHash("sha256")
      .update(`add-service|${planId}|${serviceCode ?? serviceName}|${chargeDate}|${amountCents}|${frequency}`)
      .digest("hex").slice(0, 32);

    const sub = await createSubscription({
      amount: amountCents,
      currency: "AUD",
      interval_unit: frequency,
      start_date: chargeDate ?? undefined,
      name: quantity > 1 ? `${serviceName} x${quantity}` : serviceName,
      metadata: { plan_id: planId, source: "crm-add-service" },
      links: { mandate: plan.gc_mandate_id },
    }, idem);

    // Record: link row + plan item (service-role — both tables are
    // service-role-write-only).
    const { data: linkRow, error: linkErr } = await svc
      .from("recurring_plan_gc_subscriptions")
      .insert({
        plan_id: planId,
        gc_subscription_id: sub.id,
        name: sub.name,
        amount_cents: sub.amount,
        currency: sub.currency ?? "AUD",
        interval_unit: frequency,
        interval: 1,
        start_date: sub.start_date,
        gc_status: sub.status,
        source: "crm",
      })
      .select("id")
      .single();
    if (linkErr) console.error("[add-service] link insert failed:", linkErr);

    const { error: itemErr } = await svc.from("recurring_plan_items").insert({
      recurring_plan_id: planId,
      service_code: serviceCode ?? "custom",
      service_name: serviceName.trim(),
      account_code: accountCode ?? "200",
      frequency,
      price_inc_gst: priceIncGst,
      quantity,
    });
    if (itemErr) console.error("[add-service] item insert failed:", itemErr);

    // ── Mirror into Xero so the customer is never charged without an
    // invoice (gap found 2026-07-09: GC collected, no invoice existed).
    // Failure here must NOT roll back the GC sub — it's already live — so we
    // surface loudly instead: notification + warning in the response.
    let xeroRepeatingInvoiceId: string | null = null;
    let xeroMirrorError: string | null = null;
    if (linkRow?.id) {
      try {
        const mirror = await mirrorServiceToXero(svc, {
          planId,
          subscriptionLinkId: linkRow.id,
          serviceName: serviceName.trim(),
          priceIncGst,
          quantity,
          accountCode: accountCode ?? "200",
          frequency,
          startDate: sub.start_date ?? chargeDate ?? new Date().toISOString().slice(0, 10),
        });
        xeroRepeatingInvoiceId = mirror.repeatingInvoiceId;
      } catch (err) {
        xeroMirrorError = err instanceof Error ? err.message : String(err);
        console.error("[add-service] Xero mirror failed:", err);
      }
    } else {
      xeroMirrorError = "subscription link row missing — Xero mirror skipped";
    }

    const customer = Array.isArray(plan.customers) ? plan.customers[0] : plan.customers;
    const site = Array.isArray(plan.customer_sites) ? plan.customer_sites[0] : plan.customer_sites;
    await enqueueNotification({
      typeCode: "recurring_plan.service_added",
      refType: "recurring_plan",
      refId: planId,
      audience: { allActive: true },
      title: `Service added: ${customer?.name ?? "?"}${site?.name ? ` — ${site.name}` : ""}`,
      body: `${serviceName} $${priceIncGst.toFixed(2)}/${frequency} — GC subscription ${sub.id}, first charge ${sub.start_date ?? chargeDate ?? "TBC"}.`,
      href: `/invoices/recurring/${planId}`,
    });
    if (xeroMirrorError) {
      await enqueueNotification({
        typeCode: "recurring_plan.activation_failed",
        refType: "recurring_plan",
        refId: planId,
        audience: { allActive: true },
        title: `⚠ NO XERO INVOICE for added service: ${customer?.name ?? "?"}`,
        body: `${serviceName} $${priceIncGst.toFixed(2)}/${frequency} is charging via GC sub ${sub.id} but the Xero mirror failed: ${xeroMirrorError}. Create the invoice template manually or re-run the mirror.`,
        href: `/invoices/recurring/${planId}`,
      });
    }

    return NextResponse.json({
      ok: true,
      subscriptionId: sub.id,
      firstCharge: sub.start_date ?? chargeDate,
      clampedToMandate: !!(startDate && earliest && startDate < earliest),
      xeroRepeatingInvoiceId,
      xeroMirrorError,
    });
  } catch (err) {
    if (err instanceof GoCardlessApiError) {
      return NextResponse.json({ error: `GoCardless: ${err.message}` }, { status: 502 });
    }
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed to add service" }, { status: 502 });
  }
}
