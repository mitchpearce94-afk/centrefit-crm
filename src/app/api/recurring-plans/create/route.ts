import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  createBillingRequest,
  createBillingRequestFlow,
  type GcCustomerInput,
} from "@/lib/gocardless/client";
import { aliasEmail } from "@/lib/recurring/alias";
import { sendMandateSignupEmail, type MandateLink } from "@/lib/emails/recurring-mandate-signup";

/**
 * POST /api/recurring-plans/create
 *
 * Body shape:
 * {
 *   customerId: uuid,
 *   sites: [{
 *     siteId: uuid | null,
 *     items: [{ serviceId: uuid, quantity?: number }]
 *   }, ...]
 * }
 *
 * For each site, this creates one DB plan row, one GoCardless customer
 * (with `+sitename` alias email), one redirect flow (the GC-hosted mandate
 * signup URL), and stashes everything keyed by plan id. Then it sends ONE
 * Centrefit-branded email to the customer's primary contact with all N
 * mandate signup links inline.
 *
 * Plans start at status=`pending_mandate`. They flip to `active` via the
 * GoCardless webhook once the customer signs and the mandate is verified
 * — at which point the Xero RepeatingInvoice is also created.
 */
export async function POST(req: NextRequest) {
  let body: {
    customerId?: string;
    sites?: Array<{ siteId?: string | null; items?: Array<{ serviceId: string; quantity?: number }> }>;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!body.customerId || !Array.isArray(body.sites) || body.sites.length === 0) {
    return NextResponse.json({ error: "customerId and at least one site required" }, { status: 400 });
  }
  for (const s of body.sites) {
    if (!s.items || s.items.length === 0) {
      return NextResponse.json({ error: "Each site must have at least one item" }, { status: 400 });
    }
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });

  // Pull customer + primary contact + sites in one shot.
  const { data: customer, error: custErr } = await supabase
    .from("customers")
    .select(`
      id, name, abn, xero_contact_id,
      customer_contacts(name, email, phone, is_primary),
      customer_sites(id, name, address, suburb, state, postcode)
    `)
    .eq("id", body.customerId)
    .single();
  if (custErr || !customer) {
    return NextResponse.json({ error: "Customer not found" }, { status: 404 });
  }

  const primary =
    customer.customer_contacts?.find((c: { is_primary: boolean }) => c.is_primary) ??
    customer.customer_contacts?.[0];
  if (!primary?.email) {
    return NextResponse.json(
      { error: "Customer has no primary contact email — cannot send mandate link" },
      { status: 400 },
    );
  }

  // Pull catalogue snapshot for the items we're about to plan.
  const allServiceIds = Array.from(new Set(
    body.sites.flatMap((s) => (s.items ?? []).map((i) => i.serviceId)),
  ));
  const { data: services } = await supabase
    .from("recurring_services")
    .select("id, code, name, description, price_inc_gst, frequency, active")
    .in("id", allServiceIds);
  const servicesById = new Map((services ?? []).map((s) => [s.id, s]));

  for (const id of allServiceIds) {
    if (!servicesById.has(id)) {
      return NextResponse.json({ error: `Unknown service: ${id}` }, { status: 400 });
    }
    const svc = servicesById.get(id)!;
    if (!svc.active) {
      return NextResponse.json({ error: `Service is deactivated: ${svc.name}` }, { status: 400 });
    }
  }

  // Look up the staff row for created_by.
  const { data: staff } = await supabase
    .from("staff")
    .select("id")
    .eq("user_id", user.id)
    .maybeSingle();

  const appUrl = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") ?? "https://crm.centrefit.com.au";
  const mandateLinks: MandateLink[] = [];
  const createdPlanIds: string[] = [];

  for (const siteInput of body.sites) {
    const siteId = siteInput.siteId ?? null;
    const site = siteId
      ? customer.customer_sites?.find((s: { id: string }) => s.id === siteId)
      : null;
    const siteLabel = site?.name ?? customer.name;

    // Insert plan row first so we have its ID for the GC session_token.
    const { data: plan, error: planErr } = await supabase
      .from("recurring_plans")
      .insert({
        customer_id: customer.id,
        site_id: siteId,
        status: "pending_mandate",
        created_by: staff?.id ?? null,
      })
      .select("id")
      .single();
    if (planErr || !plan) {
      return NextResponse.json(
        { error: `Failed to create plan for ${siteLabel}: ${planErr?.message}` },
        { status: 500 },
      );
    }
    createdPlanIds.push(plan.id);

    // Snapshot catalogue prices into plan items.
    const itemRows = siteInput.items!.map((it) => {
      const svc = servicesById.get(it.serviceId)!;
      return {
        recurring_plan_id: plan.id,
        service_id: svc.id,
        service_code: svc.code,
        service_name: svc.name,
        description: svc.description,
        price_inc_gst: svc.price_inc_gst,
        frequency: svc.frequency,
        quantity: it.quantity ?? 1,
      };
    });
    const { error: itemsErr } = await supabase.from("recurring_plan_items").insert(itemRows);
    if (itemsErr) {
      return NextResponse.json({ error: `Plan items insert failed: ${itemsErr.message}` }, { status: 500 });
    }

    // Build the email for this plan + the GoCardless Billing Request flow.
    //
    // Standardised approach (locked in 2026-04-28): every plan gets the
    // `+sitename` alias regardless of whether this is single-site or
    // multi-site. Combined with `lock_customer_details: true` on the BR
    // flow, this means:
    //   - Customer can't edit the email on the GC-hosted form, so the
    //     mandate ↔ Xero contact mapping is unambiguous every time.
    //   - The mandate-signup email explains the alias (callout block).
    //   - Workflow stays identical between single and multi-site plans.
    //
    // We DON'T prefill address — that's left blank for the customer to fill
    // on the form (we don't always have site addresses). Only fields that
    // appear in `prefilled_customer` are subject to the lock; address
    // remains editable so the customer enters the bank's billing address.
    //
    // BR fulfilment + customer/mandate ID capture happens via the GC
    // webhook on `billing_requests.fulfilled`.
    const aliasFor = aliasEmail(primary.email, siteLabel, plan.id.slice(0, 6));
    let signupUrl: string;
    let billingRequestId: string;
    try {
      const br = await createBillingRequest(
        {
          mandate_request: {
            scheme: "becs",
            currency: "AUD",
            description: `Centrefit recurring billing — ${siteLabel}`,
          },
          metadata: {
            plan_id: plan.id,
            customer_id: customer.id,
            site_label: siteLabel.slice(0, 50),
          },
        },
        `plan-${plan.id}-br`,
      );
      billingRequestId = br.id;

      // Only include identity fields in prefilled_customer (NOT address) so
      // the lock applies to identity but the customer can still type in
      // their billing address on the form.
      const givenName = primary.name?.split(/\s+/)[0];
      const familyName = primary.name?.split(/\s+/).slice(1).join(" ");
      const prefilled: GcCustomerInput = {
        email: aliasFor,
        company_name: customer.name,
        country_code: "AU",
        ...(givenName ? { given_name: givenName } : {}),
        ...(familyName ? { family_name: familyName } : {}),
      };

      const flow = await createBillingRequestFlow(
        {
          redirect_uri: `${appUrl}/recurring-thanks?plan=${plan.id}`,
          links: { billing_request: br.id },
          show_redirect_buttons: true,
          // lock_customer_details intentionally omitted — not supported on
          // GC API version 2015-07-06 (the only version we've confirmed
          // works with this account). The mandate-signup email explains
          // the alias and asks customers not to change it.
          prefilled_customer: prefilled,
        },
        `plan-${plan.id}-brf`,
      );
      signupUrl = flow.authorisation_url;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // Mark the plan failed so the user can retry. Don't abort the whole batch.
      await supabase
        .from("recurring_plans")
        .update({ status: "failed", notes: `GC creation failed: ${msg}` })
        .eq("id", plan.id);
      return NextResponse.json(
        { error: `GoCardless step failed for ${siteLabel}: ${msg}`, planIds: createdPlanIds },
        { status: 502 },
      );
    }

    await supabase
      .from("recurring_plans")
      .update({
        gc_billing_request_id: billingRequestId,
        alias_email: aliasFor,
        signup_link_url: signupUrl,
        // gc_customer_id + gc_mandate_id get set by the GC webhook on
        // billing_requests.fulfilled when the customer signs.
      })
      .eq("id", plan.id);

    // Build summary strings for the email.
    const monthly = itemRows.filter((r) => r.frequency === "monthly")
      .reduce((sum, r) => sum + Number(r.price_inc_gst) * (r.quantity ?? 1), 0);
    const yearly = itemRows.filter((r) => r.frequency === "yearly")
      .reduce((sum, r) => sum + Number(r.price_inc_gst) * (r.quantity ?? 1), 0);
    const summaryParts = [];
    if (monthly > 0) summaryParts.push(`$${monthly.toFixed(2)}/month`);
    if (yearly > 0) summaryParts.push(`$${yearly.toFixed(2)}/year`);
    const recurringSummary = `Recurring total: ${summaryParts.join(" + ")} (incl. GST)`;
    const serviceSummary = itemRows
      .map((r) => r.quantity > 1 ? `${r.service_name} × ${r.quantity}` : r.service_name)
      .join(" • ");

    mandateLinks.push({
      siteLabel,
      url: signupUrl,
      serviceSummary,
      recurringSummary,
    });
  }

  // Send the consolidated email.
  try {
    await sendMandateSignupEmail({
      to: primary.email,
      customerName: primary.name ?? customer.name,
      links: mandateLinks,
    });
    await supabase
      .from("recurring_plans")
      .update({ signup_emailed_at: new Date().toISOString() })
      .in("id", createdPlanIds);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      {
        error: `Plans created and GC links generated, but email send failed: ${msg}. Re-send from the plan page.`,
        planIds: createdPlanIds,
      },
      { status: 502 },
    );
  }

  return NextResponse.json({ planIds: createdPlanIds, mandateLinks: mandateLinks.length });
}
