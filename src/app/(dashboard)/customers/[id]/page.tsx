import { createClient } from "@/lib/supabase/server";
import { notFound } from "next/navigation";
import Link from "next/link";
import { DeleteCustomerButton } from "./delete-customer-button";
import { CustomerDetailTabs } from "./customer-detail-tabs";

export default async function CustomerDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const [customerResult, jobsResult, notesResult] = await Promise.all([
    supabase
      .from("customers")
      .select(
        "*, customer_contacts(*), customer_sites(*), parent:customers!parent_customer_id(id, name)"
      )
      .eq("id", id)
      .single(),
    supabase
      .from("jobs")
      .select("id, number, reference, description, status:statuses(name, colour, phase), created_at, updated_at")
      .eq("customer_id", id)
      .order("created_at", { ascending: false }),
    supabase
      .from("job_notes")
      .select("id, content, type, created_at, staff:staff(display_name, initials), job:jobs!inner(customer_id)")
      .eq("job.customer_id", id)
      .order("created_at", { ascending: false })
      .limit(50),
  ]);

  if (customerResult.error || !customerResult.data) {
    notFound();
  }

  const customer = customerResult.data;
  const jobs = jobsResult.data ?? [];
  const notes = notesResult.data ?? [];

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
            <span>{jobs.length} jobs</span>
            {customer.total_revenue > 0 && (
              <span>
                ${Number(customer.total_revenue).toLocaleString()} revenue
              </span>
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
          <DeleteCustomerButton
            customerId={id}
            customerName={customer.name}
          />
        </div>
      </div>

      <div className="mt-6">
        <CustomerDetailTabs
          customerId={id}
          customer={customer}
          contacts={customer.customer_contacts ?? []}
          sites={customer.customer_sites ?? []}
          jobs={jobs as any}
          notes={notes as any}
        />
      </div>
    </div>
  );
}
