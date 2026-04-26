import { createClient } from "@/lib/supabase/server";
import Link from "next/link";
import type { Customer } from "@/lib/types";
import { CustomerSearch } from "./customer-search";

export const dynamic = "force-dynamic";

export default async function CustomersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; type?: string }>;
}) {
  const params = await searchParams;
  const supabase = await createClient();

  let query = supabase
    .from("customers")
    .select("*, customer_contacts(id), customer_sites(id)")
    .eq("is_active", true)
    .order("name");

  if (params.q) {
    query = query.ilike("name", `%${params.q}%`);
  }
  if (params.type) {
    query = query.eq("type", params.type);
  }

  const { data: customers, error } = await query;

  if (error) {
    return <div className="text-destructive">Error loading customers: {error.message}</div>;
  }

  return (
    <div>
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Customers</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            <span className="font-medium text-foreground tabular-nums">{customers?.length ?? 0}</span> active customers
          </p>
        </div>
        <Link
          href="/customers/new"
          className="inline-flex items-center gap-1.5 rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground shadow-sm transition-all hover:bg-primary/90 hover:shadow-md"
        >
          <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
          Add Customer
        </Link>
      </div>

      <CustomerSearch defaultQuery={params.q} defaultType={params.type} />

      <div className="surface-card mt-4 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/40">
              <th className="px-4 py-2.5 text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Name</th>
              <th className="px-4 py-2.5 text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground hidden sm:table-cell">Type</th>
              <th className="px-4 py-2.5 text-right text-[10px] font-semibold uppercase tracking-wider text-muted-foreground hidden md:table-cell">Sites</th>
              <th className="px-4 py-2.5 text-right text-[10px] font-semibold uppercase tracking-wider text-muted-foreground hidden md:table-cell">Contacts</th>
              <th className="px-4 py-2.5 text-right text-[10px] font-semibold uppercase tracking-wider text-muted-foreground hidden lg:table-cell">Revenue</th>
            </tr>
          </thead>
          <tbody>
            {customers?.map((customer: Customer & { customer_contacts: { id: string }[]; customer_sites: { id: string }[] }) => (
              <tr
                key={customer.id}
                className="border-b border-border last:border-0 transition-colors hover:bg-accent/40"
              >
                <td className="px-4 py-3">
                  <Link
                    href={`/customers/${customer.id}`}
                    className="font-medium text-foreground hover:text-primary transition-colors"
                  >
                    {customer.name}
                  </Link>
                  {customer.abn && (
                    <span className="ml-2 text-xs text-muted-foreground">
                      ABN: {customer.abn}
                    </span>
                  )}
                </td>
                <td className="px-4 py-3 text-muted-foreground capitalize hidden sm:table-cell">
                  {customer.type}
                </td>
                <td className="px-4 py-3 text-right text-muted-foreground hidden md:table-cell">
                  {customer.customer_sites?.length ?? 0}
                </td>
                <td className="px-4 py-3 text-right text-muted-foreground hidden md:table-cell">
                  {customer.customer_contacts?.length ?? 0}
                </td>
                <td className="px-4 py-3 text-right text-muted-foreground hidden lg:table-cell">
                  {customer.total_revenue > 0
                    ? `$${Number(customer.total_revenue).toLocaleString()}`
                    : "—"}
                </td>
              </tr>
            ))}
            {(!customers || customers.length === 0) && (
              <tr>
                <td colSpan={5} className="px-4 py-12 text-center text-muted-foreground">
                  No customers found.{" "}
                  <Link href="/customers/new" className="text-primary hover:underline">
                    Add your first customer
                  </Link>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
