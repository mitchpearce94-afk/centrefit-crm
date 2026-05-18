import { createClient } from "@/lib/supabase/server";
import { ReportsDashboard } from "./reports-dashboard";
import { requireAnyPermissionOrNotFound } from "@/lib/auth/route-guards";

export default async function ReportsPage() {
  await requireAnyPermissionOrNotFound(["reports.view_operational", "reports.view_financial"]);
  const supabase = await createClient();

  const [jobsResult, timeResult, pipelineResult, staffResult, customersResult, quotesResult] =
    await Promise.all([
      supabase
        .from("jobs")
        .select(
          "id, number, created_at, updated_at, status:statuses(name, phase), category_1:categories!category_1_id(name), category_2:categories!category_2_id(name), job_staff(staff_id)"
        ),
      supabase
        .from("job_time")
        .select("id, job_id, staff_id, start_time, end_time, billable, staff:staff(display_name, initials, colour)"),
      supabase
        .from("pipeline_deals")
        .select("id, stage, value, probability, created_at, updated_at"),
      supabase
        .from("staff")
        .select("id, display_name, initials, colour")
        .eq("is_active", true)
        .order("display_name"),
      supabase.from("customers").select("id, name, is_active"),
      supabase.from("quotes").select("id, status, created_at, pricing_snapshot, expires_at"),
    ]);

  return (
    <div>
      <h1 className="text-2xl font-bold tracking-tight">Reports</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Business overview and key metrics.
      </p>

      <div className="mt-5">
        <ReportsDashboard
          jobs={(jobsResult.data ?? []) as any}
          timeEntries={(timeResult.data ?? []) as any}
          deals={(pipelineResult.data ?? []) as any}
          staff={staffResult.data ?? []}
          customers={(customersResult.data ?? []) as any}
          quotes={(quotesResult.data ?? []) as any}
        />
      </div>
    </div>
  );
}
