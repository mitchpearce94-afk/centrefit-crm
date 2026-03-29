import { createClient } from "@/lib/supabase/server";
import { SchedulerView } from "./scheduler-grid";

export const dynamic = "force-dynamic";

function getMonday(dateStr?: string): Date {
  const d = dateStr ? new Date(dateStr + "T00:00:00") : new Date();
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  const monday = new Date(d);
  monday.setDate(diff);
  monday.setHours(0, 0, 0, 0);
  return monday;
}

function formatDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function addDays(d: Date, n: number): Date {
  const result = new Date(d);
  result.setDate(result.getDate() + n);
  return result;
}

export default async function SchedulerPage({
  searchParams,
}: {
  searchParams: Promise<{ week?: string }>;
}) {
  const { week } = await searchParams;
  const supabase = await createClient();

  const monday = getMonday(week);
  const sunday = addDays(monday, 6);
  const mondayISO = formatDate(monday);
  const sundayISO = formatDate(sunday);

  // Get completion statuses to exclude from job picker
  const { data: completionStatuses } = await supabase
    .from("statuses")
    .select("id")
    .eq("phase", "completion");
  const completionIds = (completionStatuses ?? []).map((s) => s.id);

  // Build jobs query
  let jobsQuery = supabase
    .from("jobs")
    .select(
      "id, number, reference, customer:customers(id, name), site:customer_sites(id, name), status:statuses(id, name, colour)"
    )
    .order("number", { ascending: false })
    .limit(200);

  if (completionIds.length > 0) {
    jobsQuery = jobsQuery.not(
      "status_id",
      "in",
      `(${completionIds.join(",")})`
    );
  }

  const [staffResult, entriesResult, jobsResult, userResult] =
    await Promise.all([
      supabase
        .from("staff")
        .select("id, display_name, initials, colour, role")
        .eq("is_active", true)
        .order("display_name"),
      supabase
        .from("schedule_entries")
        .select(
          "*, job:jobs(id, number, reference, customer:customers(id, name), site:customer_sites(id, name), status:statuses(id, name, colour))"
        )
        .gte("schedule_date", mondayISO)
        .lte("schedule_date", sundayISO)
        .order("start_time"),
      jobsQuery,
      supabase.auth.getUser(),
    ]);

  const currentUserId = userResult.data.user?.id ?? "";
  const currentStaff = (staffResult.data ?? []).find(
    (s) => s.id === currentUserId
  );
  const isAdmin =
    currentStaff?.role === "admin" ||
    currentStaff?.role === "project_manager";

  return (
    <div>
      <h1 className="text-2xl font-bold tracking-tight">Scheduler</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Dispatch jobs to staff for the week.
      </p>

      <div className="mt-5">
        <SchedulerView
          staff={staffResult.data ?? []}
          entries={entriesResult.data ?? []}
          jobs={(jobsResult.data ?? []) as any}
          weekStart={mondayISO}
          currentUserId={currentUserId}
          isAdmin={isAdmin}
        />
      </div>
    </div>
  );
}
