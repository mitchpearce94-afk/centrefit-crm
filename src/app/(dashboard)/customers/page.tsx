import { createClient } from "@/lib/supabase/server";
import Link from "next/link";
import type { Customer } from "@/lib/types";
import { CustomerSearch } from "./customer-search";

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
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Customers</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {customers?.length ?? 0} active customers
          </p>
        </div>
        <Link
          href="/customers/new"
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
        >
          Add Customer
        </Link>
      </div>

      <CustomerSearch defaultQuery={params.q} defaultType={params.type} />

      <div className="mt-4 overflow-hidden rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/50">
              <th className="px-4 py-3 text-left font-medium text-muted-foreground">Name</th>
              <th className="px-4 py-3 text-left font-medium text-muted-foreground hidden sm:table-cell">Type</th>
              <th className="px-4 py-3 text-right font-medium text-muted-foreground hidden md:table-cell">Sites</th>
              <th className="px-4 py-3 text-right font-medium text-muted-foreground hidden md:table-cell">Contacts</th>
              <th className="px-4 py-3 text-right font-medium text-muted-foreground hidden lg:table-cell">Revenue</th>
            </tr>
          </thead>
          <tbody>
            {customers?.map((customer: Customer & { customer_contacts: { id: string }[]; customer_sites: { id: string }[] }) => (
              <tr
                key={customer.id}
                className="border-b border-border last:border-0 transition-colors hover:bg-muted/30"
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
