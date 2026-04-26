import { createClient } from "@/lib/supabase/server";
import Link from "next/link";
import { SitesSearch } from "./sites-search";

export default async function SitesPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; state?: string }>;
}) {
  const params = await searchParams;
  const supabase = await createClient();

  let query = supabase
    .from("customer_sites")
    .select(
      "id, name, address, suburb, state, postcode, notes, customer:customers!customer_id(id, name)"
    )
    .order("name");

  if (params.q) {
    query = query.ilike("name", `%${params.q}%`);
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
    notes: string | null;
    customer: { id: string; name: string } | { id: string; name: string }[] | null;
  };

  const rows = (sites as RawRow[] | null)?.map((r) => ({
    ...r,
    customer: Array.isArray(r.customer) ? (r.customer[0] ?? null) : r.customer,
  }));

  return (
    <div>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Sites</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {sites?.length ?? 0} sites
          </p>
        </div>
      </div>

      <SitesSearch defaultQuery={params.q} defaultState={params.state} />

      <div className="mt-4 overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/50">
              <th className="px-4 py-3 text-left font-medium text-muted-foreground">Site</th>
              <th className="px-4 py-3 text-left font-medium text-muted-foreground hidden md:table-cell">Customer</th>
              <th className="px-4 py-3 text-left font-medium text-muted-foreground hidden lg:table-cell">Address</th>
              <th className="px-4 py-3 text-left font-medium text-muted-foreground hidden sm:table-cell">State</th>
            </tr>
          </thead>
          <tbody>
            {rows?.map((site) => (
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
                <td className="px-4 py-3 text-muted-foreground hidden md:table-cell">
                  {site.customer ? (
                    <Link
                      href={`/customers/${site.customer.id}`}
                      className="hover:text-primary transition-colors"
                    >
                      {site.customer.name}
                    </Link>
                  ) : (
                    "—"
                  )}
                </td>
                <td className="px-4 py-3 text-muted-foreground hidden lg:table-cell">
                  {[site.address, site.suburb, site.postcode]
                    .filter(Boolean)
                    .join(", ") || "—"}
                </td>
                <td className="px-4 py-3 text-muted-foreground hidden sm:table-cell">
                  {site.state ?? "—"}
                </td>
              </tr>
            ))}
            {(!sites || sites.length === 0) && (
              <tr>
                <td
                  colSpan={4}
                  className="px-4 py-12 text-center text-muted-foreground"
                >
                  No sites found. Add sites from a customer page.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
