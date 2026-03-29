import { createClient } from "@/lib/supabase/server";
import { PipelineBoard } from "./pipeline-board";

export default async function PipelinePage() {
  const supabase = await createClient();

  const [dealsResult, customersResult, staffResult, categoriesResult, statusesResult] = await Promise.all([
    supabase
      .from("pipeline_deals")
      .select(
        "*, customer:customers(id, name), assigned_staff:staff!pipeline_deals_assigned_to_fkey(id, display_name, initials, colour)"
      )
      .order("updated_at", { ascending: false }),
    supabase
      .from("customers")
      .select("id, name, customer_sites(id, name)")
      .eq("is_active", true)
      .order("name"),
    supabase
      .from("staff")
      .select("id, display_name, initials, colour")
      .eq("is_active", true)
      .order("display_name"),
    supabase
      .from("categories")
      .select("*")
      .eq("is_active", true)
      .order("sort_order"),
    supabase.from("statuses").select("*").order("sort_order"),
  ]);

  return (
    <div>
      <h1 className="text-2xl font-bold tracking-tight">Sales Pipeline</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Track leads and deals from first contact to quoted.
      </p>

      <div className="mt-5">
        <PipelineBoard
          deals={(dealsResult.data ?? []) as any}
          customers={customersResult.data ?? []}
          staff={staffResult.data ?? []}
          categories={categoriesResult.data ?? []}
          statuses={statusesResult.data ?? []}
        />
      </div>
    </div>
  );
}
