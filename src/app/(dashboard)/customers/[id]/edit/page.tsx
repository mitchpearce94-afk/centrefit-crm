import { createClient } from "@/lib/supabase/server";
import { notFound } from "next/navigation";
import Link from "next/link";
import { CustomerForm } from "../../customer-form";

export default async function EditCustomerPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: customer, error } = await supabase
    .from("customers")
    .select("*")
    .eq("id", id)
    .single();

  if (error || !customer) {
    notFound();
  }

  return (
    <div>
      <div className="flex items-center gap-2">
        <Link
          href={`/customers/${id}`}
          className="text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          {customer.name}
        </Link>
        <span className="text-muted-foreground">/</span>
        <span className="text-sm">Edit</span>
      </div>
      <h1 className="mt-1 text-2xl font-bold tracking-tight">
        Edit Customer
      </h1>
      <div className="mt-6">
        <CustomerForm customer={customer} />
      </div>
    </div>
  );
}
