import { createClient } from "@/lib/supabase/server";
import { JobForm } from "../job-form";

export default async function NewJobPage() {
  const supabase = await createClient();

  const [customersResult, categoriesResult, statusesResult, staffResult] =
    await Promise.all([
      supabase
        .from("customers")
        .select("id, name, customer_sites(id, name)")
        .eq("is_active", true)
        .order("name"),
      supabase
        .from("categories")
        .select("*")
        .eq("is_active", true)
        .order("sort_order"),
      supabase.from("statuses").select("*").order("sort_order"),
      supabase
        .from("staff")
        .select("id, display_name, initials, colour")
        .eq("is_active", true)
        .order("display_name"),
    ]);

  return (
    <div>
      <h1 className="text-2xl font-bold tracking-tight">New Job</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Job number will be assigned automatically
      </p>
      <div className="mt-6">
        <JobForm
          customers={customersResult.data ?? []}
          categories={categoriesResult.data ?? []}
          statuses={statusesResult.data ?? []}
          staff={staffResult.data ?? []}
        />
      </div>
    </div>
  );
}
