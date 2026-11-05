import type { SupabaseClient } from "@supabase/supabase-js";
import type { XeroClient } from "xero-node";
import { findOrCreateBuilderContact } from "@/lib/xero/contacts";

/**
 * Who an invoice is billed to (docs/job-lifecycle-CONTEXT.md D2/D3).
 *  - owner   → the site's backing customer / site Xero contact (unchanged path)
 *  - builder → the builder on the site's Builder tab, its own Xero contact
 */
export type BillToParty = "owner" | "builder";

export function parseBillTo(value: unknown, fallback: BillToParty = "owner"): BillToParty {
  return value === "builder" ? "builder" : value === "owner" ? "owner" : fallback;
}

export const BUILDER_SITE_SELECT =
  "id, name, builder_name, builder_abn, builder_contact_name, builder_email, builder_phone, builder_address, builder_xero_contact_id";

/**
 * Resolve the builder's Xero contact for a site. Throws a plain-English error
 * when the site has no builder on file so the UI can say exactly what to fix.
 */
export async function resolveBuilderContact(
  supabase: SupabaseClient,
  xero: XeroClient,
  tenantId: string,
  siteId: string | null,
): Promise<{ contactId: string; builderName: string }> {
  if (!siteId) {
    throw new Error("Builder invoices need a site — this invoice has no site to take the builder from");
  }
  const { data: site } = await supabase
    .from("customer_sites")
    .select(BUILDER_SITE_SELECT)
    .eq("id", siteId)
    .maybeSingle();
  if (!site) throw new Error("Site not found");
  if (!site.builder_name?.trim()) {
    throw new Error(`${site.name} has no builder on file — add one on the site's Builder tab first`);
  }
  const contactId = await findOrCreateBuilderContact(supabase, xero, tenantId, {
    ...site,
    builder_name: site.builder_name,
  });
  return { contactId, builderName: site.builder_name };
}
