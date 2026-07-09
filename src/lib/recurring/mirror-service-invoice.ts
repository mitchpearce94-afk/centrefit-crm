import "server-only";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { getAuthedClient } from "@/lib/xero/client";
import { findOrCreateContact } from "@/lib/xero/contacts";
import {
  createRepeatingInvoice,
  getRepeatingInvoiceLines,
  updateRepeatingInvoiceLines,
  type PlanFrequency,
} from "@/lib/xero/repeating-invoices";
import { brisbaneDateISO } from "@/lib/dates";

type ServiceClient = ReturnType<typeof createServiceRoleClient>;

export interface MirrorServiceInput {
  planId: string;
  /** recurring_plan_gc_subscriptions.id of the link row being mirrored. */
  subscriptionLinkId: string;
  serviceName: string;
  description?: string | null;
  priceIncGst: number;
  quantity: number;
  accountCode: string;
  frequency: PlanFrequency;
  /** First GC charge date (YYYY-MM-DD). The invoice bills the same day. */
  startDate: string;
}

export interface MirrorServiceResult {
  repeatingInvoiceId: string;
  /** true = new Xero RI template created; false = line appended to existing. */
  createdTemplate: boolean;
  alreadyMirrored: boolean;
}

/**
 * Mirror an add-service GoCardless subscription into Xero invoicing so the
 * customer is never charged without an invoice behind it (the gap Mitchell
 * found 2026-07-09: add-service created the GC sub and nothing else — money
 * collected, no invoice anywhere).
 *
 *   - Plan has a CRM-linked RI of the same cadence → append the service as a
 *     line to that template (next child fires with the new line).
 *   - No RI for the cadence (imported legacy plans) → create a NEW template
 *     for just this service, AUTHORISED, starting on the first charge date.
 *
 * Idempotent via recurring_plan_gc_subscriptions.xero_mirrored_at — a
 * re-run on a mirrored row is a no-op.
 */
export async function mirrorServiceToXero(
  supabase: ServiceClient,
  input: MirrorServiceInput,
): Promise<MirrorServiceResult> {
  const { planId, subscriptionLinkId, serviceName, quantity, accountCode, frequency } = input;

  const { data: link } = await supabase
    .from("recurring_plan_gc_subscriptions")
    .select("id, xero_mirrored_at, xero_repeating_invoice_id")
    .eq("id", subscriptionLinkId)
    .single();
  if (!link) throw new Error(`Subscription link row ${subscriptionLinkId} not found`);
  if (link.xero_mirrored_at) {
    return {
      repeatingInvoiceId: link.xero_repeating_invoice_id ?? "",
      createdTemplate: false,
      alreadyMirrored: true,
    };
  }

  const { data: plan } = await supabase
    .from("recurring_plans")
    .select(`
      id, customer_id, site_id,
      xero_repeating_invoice_id, xero_repeating_invoice_secondary_id,
      customers(id, name, abn, xero_contact_id, billing_email, customer_contacts(name, email, phone, is_primary)),
      customer_sites(name, invoice_name, address, suburb, state, postcode, xero_contact_id, billing_email)
    `)
    .eq("id", planId)
    .single();
  if (!plan) throw new Error(`Plan ${planId} not found`);

  const customer = Array.isArray(plan.customers) ? plan.customers[0] : plan.customers;
  if (!customer) throw new Error(`Plan ${planId} has no customer`);
  const site = Array.isArray(plan.customer_sites) ? plan.customer_sites[0] : plan.customer_sites;

  const { client: xero, conn } = await getAuthedClient(supabase);

  const newLine = {
    description: input.description?.trim() || serviceName,
    quantity,
    unitAmount: input.priceIncGst,
    accountCode,
  };

  // ── Append path: an existing CRM-linked RI of the SAME cadence ──
  const wantPeriod = frequency === "yearly" ? 12 : 1;
  const candidateRiIds = [
    plan.xero_repeating_invoice_id,
    plan.xero_repeating_invoice_secondary_id,
  ].filter((v): v is string => !!v);
  for (const riId of candidateRiIds) {
    let state;
    try {
      state = await getRepeatingInvoiceLines(xero, conn.tenant_id, riId);
    } catch {
      continue; // template unreadable/deleted — fall through
    }
    if (state.status === "DELETED" || state.schedulePeriod !== wantPeriod) continue;

    await updateRepeatingInvoiceLines(xero, conn.tenant_id, riId, [
      ...state.lines.map((l) => ({
        description: l.description,
        quantity: l.quantity,
        unitAmount: l.unitAmount,
        accountCode: l.accountCode ?? undefined,
        taxType: l.taxType ?? undefined,
      })),
      newLine,
    ]);
    await supabase
      .from("recurring_plan_gc_subscriptions")
      .update({ xero_repeating_invoice_id: riId, xero_mirrored_at: new Date().toISOString() })
      .eq("id", subscriptionLinkId);
    return { repeatingInvoiceId: riId, createdTemplate: false, alreadyMirrored: false };
  }

  // ── Create path: no usable RI for this cadence (imported legacy plans) ──
  const { count: nbnLinkCount } = await supabase
    .from("nbn_enquiries")
    .select("id", { count: "exact", head: true })
    .eq("recurring_plan_id", planId);
  const isNbn = (nbnLinkCount ?? 0) > 0 || /\bnbn\b/i.test(serviceName);
  const brandingThemeID = isNbn
    ? process.env.XERO_BRANDING_THEME_COMMUNICATIONS_DD_ID
    : process.env.XERO_BRANDING_THEME_SOLUTIONS_DD_ID;
  if (!brandingThemeID) {
    throw new Error(
      isNbn
        ? "XERO_BRANDING_THEME_COMMUNICATIONS_DD_ID env var not set"
        : "XERO_BRANDING_THEME_SOLUTIONS_DD_ID env var not set",
    );
  }

  const primaryContact =
    customer.customer_contacts?.find((c: { is_primary: boolean }) => c.is_primary) ??
    customer.customer_contacts?.[0];
  const xeroContactId = await findOrCreateContact(
    supabase,
    xero,
    conn.tenant_id,
    {
      id: customer.id,
      name: customer.name,
      xero_contact_id: customer.xero_contact_id,
      email: primaryContact?.email ?? null,
      billing_email: (customer as { billing_email?: string | null }).billing_email ?? null,
      phone: primaryContact?.phone ?? null,
      abn: customer.abn ?? null,
    },
    plan.site_id && site
      ? {
          id: plan.site_id,
          name: site.name,
          invoice_name: (site as { invoice_name?: string | null }).invoice_name ?? null,
          xero_contact_id: (site as { xero_contact_id?: string | null }).xero_contact_id ?? null,
          billing_email: (site as { billing_email?: string | null }).billing_email ?? null,
          address: site.address ?? null,
          suburb: site.suburb ?? null,
          state: site.state ?? null,
          postcode: site.postcode ?? null,
        }
      : null,
  );

  // Xero rejects past start dates — floor to today.
  const todayStr = brisbaneDateISO(new Date());
  const riStart = input.startDate >= todayStr ? input.startDate : todayStr;

  const ri = await createRepeatingInvoice({
    xero,
    tenantId: conn.tenant_id,
    xeroContactId,
    reference: `Plan ${planId.slice(0, 8)}`,
    frequency,
    startDate: riStart,
    dueDays: 7,
    childStatus: "AUTHORISED",
    brandingThemeID,
    idempotencyKey: `crm-addsvc-${subscriptionLinkId.slice(0, 13)}`,
    lineItems: [newLine],
  });

  // Cache the new template on the plan when a slot is free so the cancel
  // flow can find and delete it; the link row always records it regardless.
  if (!plan.xero_repeating_invoice_id) {
    await supabase
      .from("recurring_plans")
      .update({ xero_repeating_invoice_id: ri.repeatingInvoiceID })
      .eq("id", planId);
  } else if (!plan.xero_repeating_invoice_secondary_id) {
    await supabase
      .from("recurring_plans")
      .update({ xero_repeating_invoice_secondary_id: ri.repeatingInvoiceID })
      .eq("id", planId);
  }

  await supabase
    .from("recurring_plan_gc_subscriptions")
    .update({
      xero_repeating_invoice_id: ri.repeatingInvoiceID,
      xero_mirrored_at: new Date().toISOString(),
    })
    .eq("id", subscriptionLinkId);

  return { repeatingInvoiceId: ri.repeatingInvoiceID, createdTemplate: true, alreadyMirrored: false };
}
