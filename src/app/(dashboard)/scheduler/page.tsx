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

  // One solid-page layout: outer container takes the remaining viewport
  // height (minus the dashboard chrome) and the time grid inside fills
  // whatever's left via flex-1 + min-h-0. No edge-to-edge bleed — page
  // padding from the layout wrapper is preserved for horizontal alignment.
  return (
    <div className="flex flex-col h-[calc(100dvh-11rem)] lg:h-[calc(100dvh-5rem)]">
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
