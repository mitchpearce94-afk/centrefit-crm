import type { SupabaseClient } from "@supabase/supabase-js";
import { getAuthedClient } from "@/lib/xero/client";
import { findOrCreateContact } from "@/lib/xero/contacts";
import {
  createXeroInvoice,
  formatScopeDescription,
  type XeroLineItemInput,
} from "@/lib/xero/invoices";

export type QuoteInvoiceType = "full" | "progress_pp1" | "progress_pp2";

export interface CreateFromQuoteResult {
  invoiceId: string;
  xeroInvoiceId: string;
  xeroInvoiceNumber: string | null;
  onlineInvoiceUrl: string | null;
  type: QuoteInvoiceType;
  total: number;
}

/**
 * Create a Xero-linked invoice from an accepted quote. Encapsulates the
 * same logic as `/api/invoices/create` for the quote-linked case, so it can
 * be invoked server-side from the quote accept flow without going through
 * HTTP.
 *
 * Determines invoice type automatically: progress quote → PP1, else full.
 * Skips PP2 — that only fires on job completion, handled elsewhere.
 *
 * Throws on Xero or DB failure. Callers decide whether to swallow or surface.
 */
export async function createInvoiceFromAcceptedQuote(
  supabase: SupabaseClient,
  quoteId: string,
): Promise<CreateFromQuoteResult> {
  const { data: quote, error: quoteErr } = await supabase
    .from("quotes")
    .select("*")
    .eq("id", quoteId)
    .single();
  if (quoteErr || !quote) throw new Error("Quote not found");
  if (quote.status !== "accepted") throw new Error("Quote is not accepted");

  const pricing = quote.pricing_snapshot as
    | { totalExGST?: number; pp1?: { total: number }; pp2?: { total: number } }
    | null;
  if (!pricing) throw new Error("Quote has no pricing snapshot");

  const isProgress = quote.quote_type === "progress";
  const type: QuoteInvoiceType = isProgress ? "progress_pp1" : "full";

  // Block dup for this quote+type (e.g. if accept webhook fires twice)
  const { data: existing } = await supabase
    .from("invoices")
    .select("id")
    .eq("quote_id", quoteId)
    .eq("invoice_type", type)
    .not("status", "eq", "void")
    .maybeSingle();
  if (existing) throw new Error(`${type} invoice already exists for this quote`);

  const siteInfo = {
    site_sqm: quote.site_sqm ?? 0,
    door_count: quote.door_count ?? 0,
    external_camera_count: quote.external_camera_count ?? 0,
    concrete_mount_black: quote.concrete_mount_black ?? 0,
    concrete_mount_white: quote.concrete_mount_white ?? 0,
    cardio_count: quote.cardio_count ?? 0,
    tv_count: quote.tv_count ?? 0,
    ceiling_tv_count: quote.ceiling_tv_count ?? 0,
    wall_tv_mount_count: quote.wall_tv_mount_count ?? 0,
    ceiling_tv_mount_count: quote.ceiling_tv_mount_count ?? 0,
    separate_studio_zone: quote.separate_studio_zone ?? false,
  };

  // BOM + product scope_roles for the scope-of-works generator
  const [{ data: scopeBomRows }, { data: scopeProductRows }] = await Promise.all([
    supabase.from("quote_line_items").select("product_id, quantity").eq("quote_id", quoteId),
    supabase.from("quote_products").select("id, scope_role, name, sku"),
  ]);
  const scopeBom = (scopeBomRows ?? []).map((r) => ({
    product_id: r.product_id ?? null,
    quantity: Number(r.quantity) || 0,
  }));
  const scopeProducts = (scopeProductRows ?? []) as Array<{ id: string; scope_role: string }>;

  // Resolve site if the quote has one. We use this both for naming the Xero
  // contact (so multi-site customers don't lump everything under one Xero
  // record) and for the site-address block on the invoice line description.
  let site: {
    id: string;
    name: string;
    address: string | null;
    suburb: string | null;
    state: string | null;
    postcode: string | null;
    xero_contact_id: string | null;
  } | null = null;
  if (quote.site_id) {
    const { data: siteRow } = await supabase
      .from("customer_sites")
      .select("id, name, address, suburb, state, postcode, xero_contact_id")
      .eq("id", quote.site_id)
      .maybeSingle();
    if (siteRow) site = siteRow;
  }
  // If quote has no site_id but has freeform site_name/site_address (legacy),
  // use those for display + the contact's billing-address slot, with no
  // persistence (we won't auto-create a customer_sites row from this path).
  const siteLabel = site?.name ?? quote.site_name ?? null;
  const siteAddrText = site
    ? [site.address, site.suburb, site.state, site.postcode].filter(Boolean).join(", ")
    : (quote.site_address ?? null);
  const siteHeader = siteLabel || siteAddrText
    ? `Site: ${[siteLabel, siteAddrText].filter(Boolean).join(" — ")}`
    : undefined;

  let headerDescription: string;
  let lineItems: XeroLineItemInput[];
  let subtotal: number;

  if (type === "full") {
    const amount = Number(pricing.totalExGST ?? 0);
    if (amount <= 0) throw new Error("Quote has no billable total");
    const description = formatScopeDescription(
      scopeBom,
      scopeProducts,
      siteInfo,
      quote.scope_overrides ?? null,
      { siteHeader },
    );
    headerDescription = `Installation per quote ${quote.ref}`;
    lineItems = [{ description, quantity: 1, unitAmount: amount }];
    subtotal = amount;
  } else {
    const amount = Number(pricing.pp1?.total ?? 0);
    if (amount <= 0) throw new Error("No PP1 amount in the quote pricing snapshot");
    const description = formatScopeDescription(
      scopeBom,
      scopeProducts,
      siteInfo,
      quote.scope_overrides ?? null,
      { siteHeader, milestoneHeader: "Progress Payment 1 — On Acceptance" },
    );
    headerDescription = `Progress Payment 1 — Quote ${quote.ref}`;
    lineItems = [{ description, quantity: 1, unitAmount: amount }];
    subtotal = amount;
  }

  const { data: customer, error: custErr } = await supabase
    .from("customers")
    .select("id, name, abn, xero_contact_id, customer_contacts(email, phone, is_primary)")
    .eq("id", quote.customer_id)
    .single();
  if (custErr || !customer) throw new Error("Customer not found");

  const primary =
    customer.customer_contacts?.find((c: { is_primary: boolean }) => c.is_primary) ??
    customer.customer_contacts?.[0];

  const { client: xero, conn } = await getAuthedClient();
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
    site
      ? {
          id: site.id,
          name: site.name,
          xero_contact_id: site.xero_contact_id,
          address: site.address,
          suburb: site.suburb,
          state: site.state,
          postcode: site.postcode,
        }
      : null,
  );

  const xeroResult = await createXeroInvoice({
    xero,
    tenantId: conn.tenant_id,
    xeroContactId,
    lineItems,
    reference: quote.ref,
  });

  const gst = Number((xeroResult.total - xeroResult.subTotal).toFixed(2));
  const { data: inserted, error: insErr } = await supabase
    .from("invoices")
    .insert({
      invoice_type: type,
      quote_id: quoteId,
      job_id: quote.job_id ?? null,
      customer_id: customer.id,
      description: headerDescription,
      line_items: lineItems,
      subtotal: xeroResult.subTotal,
      gst,
      total: xeroResult.total,
      amount_due: xeroResult.amountDue,
      amount_paid: Math.max(0, xeroResult.total - xeroResult.amountDue),
      status:
        xeroResult.status.toLowerCase() === "paid"
          ? "paid"
          : xeroResult.status.toLowerCase() === "voided"
            ? "void"
            : xeroResult.status.toLowerCase() === "draft"
              ? "draft"
              : "authorised",
      xero_invoice_id: xeroResult.invoiceID,
      xero_invoice_number: xeroResult.invoiceNumber,
      xero_online_url: xeroResult.onlineInvoiceUrl,
      xero_last_synced_at: new Date().toISOString(),
      issued_at: new Date().toISOString(),
      due_date: xeroResult.dueDate,
      auto_created: true,
    })
    .select("id")
    .single();

  if (insErr || !inserted) {
    throw new Error(
      `Created Xero invoice ${xeroResult.invoiceNumber ?? xeroResult.invoiceID} but failed to save locally: ${insErr?.message ?? "unknown"}`,
    );
  }

  // Suppress unused-var warning — subtotal is computed for parity with the
  // existing route but Xero returns canonical totals we persist instead.
  void subtotal;

  return {
    invoiceId: inserted.id,
    xeroInvoiceId: xeroResult.invoiceID,
    xeroInvoiceNumber: xeroResult.invoiceNumber,
    onlineInvoiceUrl: xeroResult.onlineInvoiceUrl,
    type,
    total: xeroResult.total,
  };
}
