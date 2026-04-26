import type { SupabaseClient } from "@supabase/supabase-js";
import { getAuthedClient } from "@/lib/xero/client";
import { findOrCreateContact } from "@/lib/xero/contacts";
import { createXeroInvoice, formatScopeDescription, type XeroLineItemInput } from "@/lib/xero/invoices";

export interface AutoPP2Result {
  created: { invoiceId: string; xeroInvoiceNumber: string | null; quoteId: string }[];
  skipped: { quoteId: string; reason: string }[];
  errors: { quoteId: string; message: string }[];
}

/**
 * Idempotent PP2 generator. Looks up every accepted progress quote linked to
 * the job and creates a PP2 draft invoice if one does not already exist.
 *
 * Runs as a side effect of any status transition into "Ready to Invoice".
 * Safe to call multiple times — duplicates are blocked by the existing PP2
 * lookup before any Xero call is made.
 */
export async function tryCreatePP2ForJob(
  supabase: SupabaseClient,
  jobId: string,
): Promise<AutoPP2Result> {
  const result: AutoPP2Result = { created: [], skipped: [], errors: [] };

  const { data: job } = await supabase
    .from("jobs")
    .select("id, status:statuses(name)")
    .eq("id", jobId)
    .single();
  if (!job) {
    return result;
  }
  const statusName = Array.isArray(job.status) ? job.status[0]?.name : (job.status as { name: string } | null)?.name;
  if (statusName !== "Ready to Invoice") {
    return result;
  }

  const { data: quotes } = await supabase
    .from("quotes")
    .select("*")
    .eq("job_id", jobId)
    .eq("quote_type", "progress")
    .eq("status", "accepted");
  if (!quotes || quotes.length === 0) {
    return result;
  }

  for (const quote of quotes) {
    try {
      const pricing = quote.pricing_snapshot as { pp2?: { total: number } } | null;
      const amount = Number(pricing?.pp2?.total ?? 0);
      if (amount <= 0) {
        result.skipped.push({ quoteId: quote.id, reason: "No PP2 amount in pricing snapshot" });
        continue;
      }

      const { data: existing } = await supabase
        .from("invoices")
        .select("id")
        .eq("quote_id", quote.id)
        .eq("invoice_type", "progress_pp2")
        .not("status", "eq", "void")
        .maybeSingle();
      if (existing) {
        result.skipped.push({ quoteId: quote.id, reason: "PP2 already exists" });
        continue;
      }

      const { data: customer, error: custErr } = await supabase
        .from("customers")
        .select("id, name, abn, xero_contact_id, customer_contacts(email, phone, is_primary)")
        .eq("id", quote.customer_id)
        .single();
      if (custErr || !customer) {
        result.errors.push({ quoteId: quote.id, message: "Customer not found" });
        continue;
      }

      const primary =
        customer.customer_contacts?.find((c: { is_primary: boolean }) => c.is_primary) ??
        customer.customer_contacts?.[0];

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
        supabase.from("quote_line_items").select("product_id, quantity").eq("quote_id", quote.id),
        supabase.from("quote_products").select("id, scope_role, name, sku"),
      ]);
      const scopeBom = (scopeBomRows ?? []).map((r) => ({
        product_id: r.product_id ?? null,
        quantity: Number(r.quantity) || 0,
      }));
      const scopeProducts = (scopeProductRows ?? []) as Array<{ id: string; scope_role: string }>;

      const header = `Progress Payment 2 — On Completion (Quote ${quote.ref})`;
      const description = formatScopeDescription(
        scopeBom,
        scopeProducts,
        siteInfo,
        quote.scope_overrides ?? null,
        header,
      );
      const lineItems: XeroLineItemInput[] = [{ description, quantity: 1, unitAmount: amount }];

      const { client: xero, conn } = await getAuthedClient();
      const xeroContactId = await findOrCreateContact(supabase, xero, conn.tenant_id, {
        id: customer.id,
        name: customer.name,
        xero_contact_id: customer.xero_contact_id,
        email: primary?.email ?? null,
        phone: primary?.phone ?? null,
        abn: customer.abn ?? null,
      });

      const xeroResult = await createXeroInvoice({
        xero,
        tenantId: conn.tenant_id,
        xeroContactId,
        lineItems,
        reference: quote.ref,
      });

      const gst = Number((xeroResult.total - xeroResult.subTotal).toFixed(2));
      const status =
        xeroResult.status.toLowerCase() === "paid"
          ? "paid"
          : xeroResult.status.toLowerCase() === "voided"
            ? "void"
            : xeroResult.status.toLowerCase() === "draft"
              ? "draft"
              : "authorised";

      const { data: inserted, error: insErr } = await supabase
        .from("invoices")
        .insert({
          invoice_type: "progress_pp2",
          quote_id: quote.id,
          job_id: jobId,
          customer_id: customer.id,
          description: header,
          line_items: lineItems,
          subtotal: xeroResult.subTotal,
          gst,
          total: xeroResult.total,
          amount_due: xeroResult.amountDue,
          amount_paid: Math.max(0, xeroResult.total - xeroResult.amountDue),
          status,
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
        result.errors.push({
          quoteId: quote.id,
          message: `Created Xero invoice ${xeroResult.invoiceNumber ?? xeroResult.invoiceID} but failed to save locally: ${insErr?.message ?? "unknown"}`,
        });
        continue;
      }

      result.created.push({
        invoiceId: inserted.id,
        xeroInvoiceNumber: xeroResult.invoiceNumber,
        quoteId: quote.id,
      });
    } catch (err: unknown) {
      result.errors.push({
        quoteId: quote.id,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return result;
}
