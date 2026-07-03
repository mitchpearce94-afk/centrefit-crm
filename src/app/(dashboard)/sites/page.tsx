import { createClient } from "@/lib/supabase/server";
import Link from "next/link";
import { SitesSearch } from "./sites-search";
import { AddSiteButton, type OwnerPrefillOption } from "./add-site-button";

export default async function SitesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; state?: string }>;
}) {
  const params = await searchParams;
  const supabase = await createClient();

  // Site-first search (D1): matching an owner's name finds their site(s),
  // so resolve owner-name hits to customer ids first — PostgREST .or() can't
  // OR across a joined relation.
  let matchedCustomerIds: string[] = [];
  if (params.q) {
    const { data: matchedCustomers } = await supabase
      .from("customers")
      .select("id")
      .ilike("name", `%${params.q}%`)
      .limit(200);
    matchedCustomerIds = (matchedCustomers ?? []).map((r) => r.id as string);
  }

  let query = supabase
    .from("customer_sites")
    .select("id, name, address, suburb, state, postcode, phone, email, notes")
    .order("name");

  if (params.q) {
    const clauses = [`name.ilike.%${params.q}%`, `suburb.ilike.%${params.q}%`];
    if (matchedCustomerIds.length > 0) {
      clauses.push(`customer_id.in.(${matchedCustomerIds.join(",")})`);
    }
    query = query.or(clauses.join(","));
  }
  if (params.state) {
    query = query.eq("state", params.state);
  }

  const { data: sites, error } = await query;

  if (error) {
    return (
      <div className="text-destructive">Error loading sites: {error.message}</div>
    );
  }

  type RawRow = {
    id: string;
    name: string;
    address: string | null;
    suburb: string | null;
    state: string | null;
    postcode: string | null;
    phone: string | null;
    email: string | null;
    notes: string | null;
  };

  const rows = (sites as RawRow[] | null) ?? [];

  // Owner prefill options for "Copy owner from an existing site…" in the
  // add-site form (D2: the new site still gets its OWN backing record).
  const { data: prefillRows } = await supabase
    .from("customer_sites")
    .select("id, name, customer:customers!customer_id(name, abn, billing_email, customer_contacts(name, email, phone, is_primary))")
    .order("name")
    .limit(500);
  const ownerPrefills: OwnerPrefillOption[] = (prefillRows ?? []).flatMap((r) => {
    const c = Array.isArray(r.customer) ? r.customer[0] : r.customer;
    if (!c) return [];
    const contacts = (c.customer_contacts ?? []) as { name: string | null; email: string | null; phone: string | null; is_primary: boolean }[];
    const primary = contacts.find((x) => x.is_primary) ?? contacts[0];
    return [{
      siteId: r.id as string,
      siteName: r.name as string,
      ownerName: c.name as string,
      abn: (c.abn as string | null) ?? null,
      billingEmail: (c.billing_email as string | null) ?? null,
      contactName: primary?.name ?? null,
      contactEmail: primary?.email ?? null,
      contactPhone: primary?.phone ?? null,
    }];
  });

  return (
    <div>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Sites</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {sites?.length ?? 0} sites
          </p>
        </div>
        <AddSiteButton ownerPrefills={ownerPrefills} />
      </div>

      <SitesSearch defaultQuery={params.q} defaultState={params.state} />

      <div className="mt-4 overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/50">
              <th className="px-4 py-3 text-left font-medium text-muted-foreground">Site</th>
              <th className="px-4 py-3 text-left font-medium text-muted-foreground hidden md:table-cell">Email</th>
              <th className="px-4 py-3 text-left font-medium text-muted-foreground hidden sm:table-cell">Phone</th>
              <th className="px-4 py-3 text-left font-medium text-muted-foreground hidden lg:table-cell">Address</th>
              <th className="px-4 py-3 text-left font-medium text-muted-foreground hidden xl:table-cell">State</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((site) => (
              <tr
                key={site.id}
                className="border-b border-border last:border-0 transition-colors hover:bg-muted/30"
              >
                <td className="px-4 py-3">
                  <Link
                    href={`/sites/${site.id}`}
                    className="font-medium text-foreground hover:text-primary transition-colors"
                  >
                    {site.name}
                  </Link>
                </td>
                <td className="px-4 py-3 text-muted-foreground hidden md:table-cell font-mono text-xs">
                  {site.email ?? "—"}
                </td>
                <td className="px-4 py-3 text-muted-foreground hidden sm:table-cell">
                  {site.phone ?? "—"}
                </td>
                <td className="px-4 py-3 text-muted-foreground hidden lg:table-cell">
                  {[site.address, site.suburb, site.postcode]
                    .filter(Boolean)
                    .join(", ") || "—"}
                </td>
                <td className="px-4 py-3 text-muted-foreground hidden xl:table-cell">
                  {site.state ?? "—"}
                </td>
              </tr>
            ))}
            {(!sites || sites.length === 0) && (
              <tr>
                <td
                  colSpan={5}
                  className="px-4 py-12 text-center text-muted-foreground"
                >
                  No sites found. Use “+ Add site” above.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
