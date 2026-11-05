import type { SupabaseClient } from "@supabase/supabase-js";
import type { XeroClient } from "xero-node";
import { findOrCreateBuilderContact } from "@/lib/xero/contacts";

/**
 * Who an invoice is billed to (docs/job-lifecycle-CONTEXT.md D2/D3/D9–D11).
 *  - owner   → the site's backing customer / site Xero contact (unchanged path)
 *  - builder → one of the site's builders (site_builders), its own Xero contact
 */
export type BillToParty = "owner" | "builder";

export function parseBillTo(value: unknown, fallback: BillToParty = "owner"): BillToParty {
  return value === "builder" ? "builder" : value === "owner" ? "owner" : fallback;
}

export const SITE_BUILDER_SELECT = "id, site_id, name, abn, contact_name, email, phone, address, xero_contact_id";

export interface SiteBuilderRow {
  id: string;
  site_id: string;
  name: string;
  abn: string | null;
  contact_name: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  xero_contact_id: string | null;
}

/**
 * Pick the builder an invoice goes to: the one named, else the site's only
 * builder. Throws plain-English errors so the UI can say what to fix.
 */
export async function pickBuilder(
  supabase: SupabaseClient,
  opts: { siteId: string | null; builderId?: string | null },
): Promise<SiteBuilderRow> {
  if (opts.builderId) {
    const { data } = await supabase.from("site_builders").select(SITE_BUILDER_SELECT).eq("id", opts.builderId).maybeSingle();
    if (!data) throw new Error("That builder is no longer on the site");
    return data as SiteBuilderRow;
  }
  if (!opts.siteId) {
    throw new Error("Builder invoices need a site — this invoice has no site to take the builder from");
  }
  const { data: rows } = await supabase.from("site_builders").select(SITE_BUILDER_SELECT).eq("site_id", opts.siteId).order("created_at");
  const builders = (rows ?? []) as SiteBuilderRow[];
  if (builders.length === 0) throw new Error("This site has no builder on file — add one on the site's Builder tab first");
  if (builders.length > 1) throw new Error("This site has more than one builder — pick which one to bill");
  return builders[0];
}

/** Resolve (and cache) the builder's Xero contact. */
export async function resolveBuilderContact(
  supabase: SupabaseClient,
  xero: XeroClient,
  tenantId: string,
  opts: { siteId: string | null; builderId?: string | null },
): Promise<{ contactId: string; builder: SiteBuilderRow }> {
  const builder = await pickBuilder(supabase, opts);
  const contactId = await findOrCreateBuilderContact(supabase, xero, tenantId, builder);
  return { contactId, builder };
}
