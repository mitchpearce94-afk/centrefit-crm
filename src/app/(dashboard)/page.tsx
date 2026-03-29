import { createClient } from "@/lib/supabase/server";
import Link from "next/link";
import { DashboardFilters } from "./dashboard-filters";

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ staff?: string; category?: string }>;
}) {
  const params = await searchParams;
  const supabase = await createClient();

  const completionIds = await getCompletionStatusIds(supabase);
  const todayISO = new Date().toISOString().split("T")[0];

  // Fetch filter options
  const [staffListResult, categoriesResult] = await Promise.all([
    supabase.from("staff").select("id, display_name").eq("is_active", true).order("display_name"),
    supabase.from("categories").select("id, name").eq("type", "business_unit").eq("is_active", true).order("name"),
  ]);

  // Build filtered job query
  let jobQuery = supabase
    .from("jobs")
    .select("id, number, reference, due_date, updated_at, customer:customers(name), status:statuses(name, colour, phase), category_2:categories!category_2_id(id, name), job_staff(staff_id)")
    .not("status_id", "in", `(${completionIds})`)
    .order("updated_at", { ascending: false });

  if (params.category) {
    jobQuery = jobQuery.eq("category_2_id", params.category);
  }

  const [
    { data: { user } },
    { data: allActiveJobs },
    { count: totalCustomers },
    { data: pipelineDeals },
    { data: todaySchedule },
  ] = await Promise.all([
    supabase.auth.getUser(),
    jobQuery,
    supabase.from("customers").select("id", { count: "exact", head: true }).eq("is_active", true),
    supabase.from("pipeline_deals").select("id, value, stage").not("stage", "in", "(won,lost,accepted)"),
    supabase.from("schedule_entries")
      .select("id, start_time, end_time, notes, staff:staff(display_name, initials, colour), job:jobs(id, number, customer:customers(name), site:customer_sites(name))")
      .eq("schedule_date", todayISO)
      .order("start_time"),
  ]);

  // Filter by staff if selected
  let filteredJobs = allActiveJobs ?? [];
  if (params.staff) {
    filteredJobs = filteredJobs.filter((j: any) =>
      j.job_staff?.some((js: any) => js.staff_id === params.staff)
    );
  }

  const recentJobs = filteredJobs.slice(0, 5);
  const overdueJobs = filteredJobs.filter((j: any) => j.due_date && j.due_date < todayISO);

  const staffResult = await supabase.from("staff").select("display_name").eq("id", user?.id ?? "").single();
  const displayName = staffResult.data?.display_name ?? user?.email ?? "";

  // Filter today's schedule by staff
  let filteredSchedule = todaySchedule ?? [];
  if (params.staff) {
    filteredSchedule = filteredSchedule.filter((e: any) => e.staff?.id === params.staff || false);
  }

  return (
    <div>
      <h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>
      <p className="mt-1 text-sm text-muted-foreground">Welcome back, {displayName}</p>

      {/* Filters */}
      <DashboardFilters
        staffList={staffListResult.data ?? []}
        categories={categoriesResult.data ?? []}
        currentStaff={params.staff}
        currentCategory={params.category}
      />

      {/* Stats */}
      <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Active Jobs" value={String(filteredJobs.length)} href="/jobs" />
        <StatCard label="Customers" value={String(totalCustomers ?? 0)} href="/customers" />
        <StatCard label="Overdue" value={String(overdueJobs.length)} warning={overdueJobs.length > 0} />
        <StatCard
          label="Pipeline Value"
          value={`$${(pipelineDeals ?? []).reduce((sum: number, d: any) => sum + (d.value ?? 0), 0).toLocaleString("en-AU")}`}
          href="/pipeline"
        />
      </div>

      <div className="mt-8 grid gap-8 lg:grid-cols-2">
        {/* Recent Jobs */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-lg font-semibold">Recent Jobs</h2>
            <Link href="/jobs" className="text-sm text-primary hover:text-primary/80 transition-colors">View all</Link>
          </div>
          <div className="rounded-lg border border-border overflow-hidden">
            {recentJobs.length > 0 ? (
              recentJobs.map((job: any) => (
                <Link key={job.id} href={`/jobs/${job.id}`} className="flex items-center justify-between border-b border-border last:border-0 px-4 py-3 hover:bg-muted/30 transition-colors">
                  <div>
                    <span className="font-mono text-sm font-medium">{job.number}</span>
                    <span className="ml-2 text-sm text-muted-foreground">{job.customer?.name}</span>
                  </div>
                  {job.status && (
                    <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium" style={{ backgroundColor: `${job.status.colour}20`, color: job.status.colour }}>
                      <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: job.status.colour }} />
                      {job.status.name}
                    </span>
                  )}
                </Link>
              ))
            ) : (
              <div className="px-4 py-8 text-center text-sm text-muted-foreground">
                {params.staff || params.category ? "No jobs match the current filters." : "No active jobs."}
              </div>
            )}
          </div>
        </div>

        {/* Today's Schedule */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-lg font-semibold">Today&apos;s Schedule</h2>
            <Link href="/scheduler" className="text-sm text-primary hover:text-primary/80 transition-colors">Full schedule</Link>
          </div>
          <div className="rounded-lg border border-border overflow-hidden">
            {filteredSchedule.length > 0 ? (
              filteredSchedule.map((entry: any) => (
                <Link key={entry.id} href={`/jobs/${entry.job?.id}`} className="flex items-center justify-between border-b border-border last:border-0 px-4 py-3 hover:bg-muted/30 transition-colors">
                  <div className="flex items-center gap-2">
                    {entry.staff && (
                      <span className="flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-medium text-white" style={{ backgroundColor: entry.staff.colour ?? "#3b82f6" }}>
                        {entry.staff.initials}
                      </span>
                    )}
                    <div>
                      <span className="font-mono text-sm font-medium">{entry.job?.number}</span>
                      <span className="ml-2 text-sm text-muted-foreground">
                        {entry.job?.customer?.name}{entry.job?.site ? ` · ${entry.job.site.name}` : ""}
                      </span>
                    </div>
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {entry.start_time && entry.end_time ? `${entry.start_time.slice(0, 5)} - ${entry.end_time.slice(0, 5)}` : "All day"}
                  </span>
                </Link>
              ))
            ) : (
              <div className="px-4 py-8 text-center text-sm text-muted-foreground">No jobs scheduled today.</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function StatCard({ label, value, href, warning }: { label: string; value: string; href?: string; warning?: boolean }) {
  const content = (
    <div className={`rounded-lg border p-5 transition-colors ${warning ? "border-destructive/30 bg-destructive/5" : "border-border bg-card"} ${href ? "hover:bg-muted/50 cursor-pointer" : ""}`}>
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className={`mt-1 text-2xl font-semibold ${warning ? "text-destructive" : ""}`}>{value}</p>
    </div>
  );
  return href ? <Link href={href}>{content}</Link> : content;
}

async function getCompletionStatusIds(supabase: any): Promise<string> {
  const { data } = await supabase.from("statuses").select("id").in("name", ["Complete", "Cancelled"]);
  return (data ?? []).map((s: any) => s.id).join(",");
}
