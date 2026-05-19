import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  createBillingRequest,
  createBillingRequestFlow,
  collectCustomerDetails,
  getMandate,
} from "@/lib/gocardless/client";
import { aliasEmail } from "@/lib/recurring/alias";
import { sendMandateSignupEmail, type MandateLink } from "@/lib/emails/recurring-mandate-signup";
import { activatePlan } from "@/lib/recurring/activate-plan";
import { createServiceRoleClient } from "@/lib/supabase/service";

/**
 * Site input for orchestration. siteId is null when the customer doesn't
 * have a sites split (rare for B2B, normal for residential signup via the
 * public website endpoint).
 */
export interface OrchestrationSiteInput {
  siteId: string | null;
  items: Array<{ serviceId: string; quantity?: number }>;
}

export interface OrchestrationCustomer {
  id: string;
  name: string;
}

export interface OrchestrationContact {
  name: string | null;
  email: string;
  phone?: string | null;
}

export interface OrchestrationService {
  id: string;
  code: string;
  name: string;
  description: string | null;
  price_inc_gst: number | string;
  frequency: "monthly" | "yearly";
  account_code: string;
  active: boolean;
}

export interface CreateRecurringPlansInput {
  /** Service-role client for public flow, user-scoped client for staff flow. */
  supabase: SupabaseClient;
  customer: OrchestrationCustomer;
  /** Optional: e.g. customer-level sites to look up siteLabel by id. */
  customerSitesById?: Map<string, { name: string }>;
  primary: OrchestrationContact;
  servicesById: Map<string, OrchestrationService>;
  sites: OrchestrationSiteInput[];
  /** Optional first invoice date (YYYY-MM-DD); null = bill on mandate verify. */
  firstInvoiceDate: string | null;
  /** staff.id — null when called from the public website endpoint. */
  createdByStaffId: string | null;
  /** App URL used in the GC redirect (e.g. https://crm.centrefit.com.au). */
  appUrl: string;
  /** Send the consolidated mandate-signup email. Public flow may opt to skip. */
  sendEmail?: boolean;
  /**
   * Attach an existing GoCardless mandate instead of going through the
   * billing-request → customer-signs → webhook cycle. When set:
   *   - No billing request is created.
   *   - No signup email is sent.
   *   - The plan is inserted with gc_mandate_id set directly.
   *   - activatePlan() runs immediately so the Xero RepeatingInvoice is
   *     created in the same request.
   * Applies to ALL sites in the input (one mandate per plan is the contract).
   * Per-site mandate selection would need a different shape; we currently
   * don't have a use case for that.
   */
  existingMandateId?: string;
}

export interface CreatedPlan {
  planId: string;
  siteLabel: string;
  signupUrl: string;
  alias: string;
}

export interface CreateRecurringPlansResult {
  plans: CreatedPlan[];
  emailedTo: string | null;
}

/**
 * Shared orchestration: per site, insert plan + items, create GoCardless
 * Billing Request + Billing Request Flow, persist linkage, optionally send
 * the consolidated mandate-signup email. Used by both staff (`/api/recurring-
 * plans/create`) and public website (`/api/public/recurring-signup`) flows.
 *
 * Throws on the first failed site — caller decides how to surface partial
 * progress (the staff flow returns the planIds it managed to create).
 */
export async function createRecurringPlansForSites(
  input: CreateRecurringPlansInput,
): Promise<CreateRecurringPlansResult> {
  const {
    supabase, customer, customerSitesById, primary, servicesById,
    sites, firstInvoiceDate, createdByStaffId, appUrl, sendEmail = true,
    existingMandateId,
  } = input;

  // If staff picked an existing mandate, verify it exists + is usable BEFORE
  // we insert any plans. We don't want half-inserted plans pointing at a
  // mandate ID that GoCardless 404s.
  let verifiedMandateGcCustomerId: string | null = null;
  if (existingMandateId) {
    const m = await getMandate(existingMandateId);
    if (m.status === "cancelled" || m.status === "failed" || m.status === "expired" || m.status === "blocked") {
      throw new Error(`Cannot attach mandate ${existingMandateId}: status is ${m.status}`);
    }
    verifiedMandateGcCustomerId = m.links.customer;
  }

  const mandateLinks: MandateLink[] = [];
  const created: CreatedPlan[] = [];

  for (const siteInput of sites) {
    const siteId = siteInput.siteId ?? null;
    const siteRecord = siteId ? customerSitesById?.get(siteId) : undefined;
    const siteLabel = siteRecord?.name ?? customer.name;

    const { data: plan, error: planErr } = await supabase
      .from("recurring_plans")
      .insert({
        customer_id: customer.id,
        site_id: siteId,
        status: "pending_mandate",
        created_by: createdByStaffId,
        first_invoice_date: firstInvoiceDate,
      })
      .select("id")
      .single();
    if (planErr || !plan) {
      throw new Error(`Failed to create plan for ${siteLabel}: ${planErr?.message ?? "unknown"}`);
    }

    // Snapshot catalogue prices into plan items.
    const itemRows = siteInput.items.map((it) => {
      const svc = servicesById.get(it.serviceId);
      if (!svc) throw new Error(`Unknown service: ${it.serviceId}`);
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
    const { error: itemsErr } = await supabase.from("recurring_plan_items").insert(itemRows);
    if (itemsErr) throw new Error(`Plan items insert failed: ${itemsErr.message}`);

    // ── Existing-mandate branch ──
    // Skip the billing-request → signup → webhook cycle and go straight to
    // activatePlan. The plan starts active in the same request.
    if (existingMandateId) {
      await supabase
        .from("recurring_plans")
        .update({
          gc_mandate_id: existingMandateId,
          gc_customer_id: verifiedMandateGcCustomerId,
          // Empty signup linkage — there was no signup.
          alias_email: null,
          signup_link_url: null,
        })
        .eq("id", plan.id);

      // activatePlan requires a service-role client (it writes the Xero RI
      // back to the plan + enqueues notifications). Build one inline.
      const sr = createServiceRoleClient();
      const actResult = await activatePlan(sr, plan.id);
      if (!actResult.ok) {
        // Roll back to a clearly-broken state so it's obvious in the UI.
        await supabase
          .from("recurring_plans")
          .update({ status: "failed", notes: `Activation failed: ${actResult.reason}` })
          .eq("id", plan.id);
        throw new Error(`Failed to activate plan for ${siteLabel}: ${actResult.reason}`);
      }

      created.push({ planId: plan.id, siteLabel, signupUrl: "", alias: "" });
      continue;
    }

    // Build GC alias + Billing Request + flow.
    const alias = aliasEmail(primary.email, siteLabel, plan.id.slice(0, 6));
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

      const givenName = primary.name?.split(/\s+/)[0];
      const familyName = primary.name?.split(/\s+/).slice(1).join(" ");

      // Step 2 of the GC mandate flow: attach the customer detail to the
      // billing request via collect_customer_details. Without this action
      // the `lock_customer_details: true` flag on the flow below is a
      // no-op — the customer can still edit name/email on the hosted page,
      // which breaks our alias-per-site routing if they "fix" the alias
      // back to their real email.
      await collectCustomerDetails(
        br.id,
        {
          customer: {
            email: alias,
            company_name: siteLabel,
            ...(givenName ? { given_name: givenName } : {}),
            ...(familyName ? { family_name: familyName } : {}),
          },
          customer_billing_detail: { country_code: "AU" },
        },
        `plan-${plan.id}-ccd`,
      );

      const flow = await createBillingRequestFlow(
        {
          redirect_uri: `${appUrl}/recurring-thanks?plan=${plan.id}`,
          links: { billing_request: br.id },
          show_redirect_buttons: true,
          // Locks the fields we attached above (alias email + company
          // name + given/family). Country code goes on customer_billing_
          // detail; the customer fills in the rest of their address on
          // the hosted page (we don't have it server-side at signup time).
          lock_customer_details: true,
        },
        `plan-${plan.id}-brf`,
      );
      signupUrl = flow.authorisation_url;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // Mark this plan as failed so it doesn't sit pending forever.
      await supabase
        .from("recurring_plans")
        .update({ status: "failed", notes: `GC creation failed: ${msg}` })
        .eq("id", plan.id);
      throw new Error(`GoCardless step failed for ${siteLabel}: ${msg}`);
    }

    await supabase
      .from("recurring_plans")
      .update({
        gc_billing_request_id: billingRequestId,
        alias_email: alias,
        signup_link_url: signupUrl,
      })
      .eq("id", plan.id);

    const monthly = itemRows.filter((r) => r.frequency === "monthly")
      .reduce((sum, r) => sum + Number(r.price_inc_gst) * (r.quantity ?? 1), 0);
    const yearly = itemRows.filter((r) => r.frequency === "yearly")
      .reduce((sum, r) => sum + Number(r.price_inc_gst) * (r.quantity ?? 1), 0);
    const summaryParts: string[] = [];
    if (monthly > 0) summaryParts.push(`$${monthly.toFixed(2)}/month`);
    if (yearly > 0) summaryParts.push(`$${yearly.toFixed(2)}/year`);
    const recurringSummary = `Recurring total: ${summaryParts.join(" + ")} (incl. GST)`;
    const serviceSummary = itemRows
      .map((r) => r.quantity > 1 ? `${r.service_name} × ${r.quantity}` : r.service_name)
      .join(" • ");

    mandateLinks.push({ siteLabel, url: signupUrl, serviceSummary, recurringSummary });
    created.push({ planId: plan.id, siteLabel, signupUrl, alias });
  }

  let emailedTo: string | null = null;
  // Existing-mandate path produces zero mandateLinks (no signup needed), so
  // the email is naturally skipped — but be explicit for the reader.
  if (sendEmail && mandateLinks.length > 0 && !existingMandateId) {
    await sendMandateSignupEmail({
      to: primary.email,
      customerName: primary.name ?? customer.name,
      links: mandateLinks,
    });
    emailedTo = primary.email;
    await supabase
      .from("recurring_plans")
      .update({ signup_emailed_at: new Date().toISOString() })
      .in("id", created.map((c) => c.planId));
  }

  return { plans: created, emailedTo };
}
