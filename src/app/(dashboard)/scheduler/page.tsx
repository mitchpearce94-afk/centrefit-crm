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
      // Pull anything that overlaps the visible week. Single-day entries
      // are bounded by [monday, sunday]; multi-day entries are kept in the
      // result if their end_date is on/after monday and they started on/
      // before sunday — the grid expands them across the days they span.
      supabase
        .from("schedule_entries")
        .select(
          "*, job:jobs(id, number, reference, customer:customers(id, name), site:customer_sites(id, name), status:statuses(id, name, colour))"
        )
        .lte("schedule_date", sundayISO)
        .or(`end_date.gte.${mondayISO},and(end_date.is.null,schedule_date.gte.${mondayISO})`)
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

  // Cancel the layout's p-4 md:p-6 wrapper so the scheduler can fill the
  // full main content area edge-to-edge, then take up exactly the visible
  // height (no outer scroll, only the time grid scrolls internally).
  return (
    <div
      className="-m-4 md:-m-6 flex flex-col px-4 md:px-6 py-3 md:py-4 h-[calc(100dvh-8rem)] lg:h-[calc(100dvh-3rem)]"
    >
      <SchedulerView
        staff={staffResult.data ?? []}
        entries={entriesResult.data ?? []}
        jobs={(jobsResult.data ?? []) as any}
        weekStart={mondayISO}
        currentUserId={currentUserId}
        isAdmin={isAdmin}
      />
    </div>
  );
}
