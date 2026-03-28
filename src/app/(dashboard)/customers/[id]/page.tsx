import { createClient } from "@/lib/supabase/server";
import { notFound } from "next/navigation";
import Link from "next/link";
import { ContactsList } from "./contacts-list";
import { SitesList } from "./sites-list";
import { DeleteCustomerButton } from "./delete-customer-button";

export default async function CustomerDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: customer, error } = await supabase
    .from("customers")
    .select(
      "*, customer_contacts(*), customer_sites(*), parent:customers!parent_customer_id(id, name)"
    )
    .eq("id", id)
    .single();

  if (error || !customer) {
    notFound();
  }

  // Get job count for this customer
  const { count: jobCount } = await supabase
    .from("jobs")
    .select("id", { count: "exact", head: true })
    .eq("customer_id", id);

  return (
    <div>
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2">
            <Link
              href="/customers"
              className="text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              Customers
            </Link>
            <span className="text-muted-foreground">/</span>
          </div>
          <h1 className="mt-1 text-2xl font-bold tracking-tight">
            {customer.name}
          </h1>
          <div className="mt-1 flex items-center gap-3 text-sm text-muted-foreground">
            <span className="capitalize">{customer.type}</span>
            {customer.abn && <span>ABN: {customer.abn}</span>}
            {jobCount !== null && <span>{jobCount} jobs</span>}
            {customer.total_revenue > 0 && (
              <span>${Number(customer.total_revenue).toLocaleString()} revenue</span>
            )}
          </div>
        </div>
        <div className="flex gap-2">
          <Link
            href={`/customers/${id}/edit`}
            className="rounded-md border border-border px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            Edit
          </Link>
          <DeleteCustomerButton customerId={id} customerName={customer.name} />
        </div>
      </div>

      {customer.notes && (
        <div className="mt-4 rounded-lg border border-border bg-card p-4 text-sm text-muted-foreground">
          {customer.notes}
        </div>
      )}

      <div className="mt-8 grid gap-8 lg:grid-cols-2">
        <div>
          <ContactsList
            customerId={id}
            contacts={customer.customer_contacts ?? []}
          />
        </div>
        <div>
          <SitesList
            customerId={id}
            sites={customer.customer_sites ?? []}
          />
        </div>
      </div>
    </div>
  );
}
