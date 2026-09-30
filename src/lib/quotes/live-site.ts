import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * A quote stores its own copy of the site name and address (what the customer
 * saw). While a quote is still a DRAFT that copy should follow the site record
 * (Mitchell 30 Sep 2026: edited the Bundaberg site, quote kept the old
 * address). Once sent, the stored copy is frozen — the send route refreshes it
 * one last time at send.
 */
export function formatSiteAddress(s: { address?: string | null; suburb?: string | null; state?: string | null; postcode?: string | null }): string {
  return [s.address, s.suburb, s.state, s.postcode].filter((x) => !!x && String(x).trim().length > 0).join(", ");
}

export async function withLiveSite<T extends { status?: string | null; site_id?: string | null; site_name?: string | null; site_address?: string | null }>(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any, any, any>,
  quote: T,
  opts: { force?: boolean } = {},
): Promise<T> {
  if (!quote.site_id) return quote;
  if (!opts.force && quote.status !== "draft") return quote;
  const { data } = await supabase
    .from("customer_sites")
    .select("name, address, suburb, state, postcode")
    .eq("id", quote.site_id)
    .maybeSingle();
  if (!data) return quote;
  const address = formatSiteAddress(data);
  return { ...quote, site_name: data.name ?? quote.site_name, site_address: address || quote.site_address };
}
