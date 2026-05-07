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
  const todayDate = new Date();
  const todayISO = isoDate(todayDate);
  const tomorrowISO = isoDate(addDays(todayDate, 1));
  const weekEndISO = isoDate(addDays(todayDate, 7));

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
    { data: upcomingSchedule },
  ] = await Promise.all([
    supabase.auth.getUser(),
    jobQuery,
    supabase.from("customers").select("id", { count: "exact", head: true }).eq("is_active", true),
    supabase.from("pipeline_deals").select("id, value, stage").not("stage", "in", "(won,lost,accepted)"),
    supabase.from("schedule_entries")
      .select("id, start_time, end_time, notes, staff_id, entry_type, title, staff:staff(id, display_name, initials, colour), job:jobs(id, number, customer:customers(name), site:customer_sites(name))")
      .eq("schedule_date", todayISO)
      .order("start_time"),
    supabase.from("schedule_entries")
      .select("id, schedule_date, start_time, end_time, notes, staff_id, entry_type, title, staff:staff(id, display_name, initials, colour), job:jobs(id, number, customer:customers(name), site:customer_sites(name))")
      .gte("schedule_date", tomorrowISO)
      .lte("schedule_date", weekEndISO)
      .order("schedule_date")
      .order("start_time"),
  ]);

  // Filter by staff if selected (desktop filter UI)
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

  const greeting = (() => {
    const h = new Date().getHours();
    if (h < 5) return "Working late,";
    if (h < 12) return "Good morning,";
    if (h < 17) return "Good afternoon,";
    return "Good evening,";
  })();

  // ── Mobile "Today" view data ──
  // Mobile is tech-focused: only show entries assigned to the current user
  // unless the user has no staff record (admin, ops). Falls back to "all"
  // when there's no staff link so the page isn't empty.
  const myStaffId = user?.id ?? null;
  const myToday = (todaySchedule ?? []).filter((e: any) =>
    !myStaffId ? true : e.staff_id === myStaffId
  );
  const myUpcoming = (upcomingSchedule ?? []).filter((e: any) =>
    !myStaffId ? true : e.staff_id === myStaffId
  );
  // Active jobs where the current user is assigned but the job isn't already
  // on today's or tomorrow's schedule — surfaces in-progress / on-hold work
  // that hasn't been booked in yet, so techs see it without leaving Today.
  const scheduledJobIds = new Set<string>([
    ...myToday.map((e: any) => e.job?.id).filter(Boolean),
    ...myUpcoming.map((e: any) => e.job?.id).filter(Boolean),
  ]);
  const myUnscheduledJobs = (allActiveJobs ?? []).filter((j: any) =>
    j.job_staff?.some((js: any) => js.staff_id === myStaffId) &&
    !scheduledJobIds.has(j.id)
  ).slice(0, 8);

  return (
    <div>
      {/* ── Mobile: Today view ── (techs filling jobs out on the road) */}
      <div className="lg:hidden">
        <h1 className="text-2xl font-bold tracking-tight">Today</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {greeting} <span className="text-foreground font-medium">{displayName.split(" ")[0]}</span>
          <span className="text-muted-foreground"> · {todayDate.toLocaleDateString("en-AU", { weekday: "long", day: "numeric", month: "long" })}</span>
        </p>

        <MobileSection title="Now" emptyHint="Nothing scheduled today.">
          {myToday.map((e: any) => (
            <MobileEntryCard key={e.id} entry={e} showDate={false} />
          ))}
        </MobileSection>

        <MobileSection title="Coming up" emptyHint="Nothing on the calendar this week.">
          {myUpcoming.map((e: any) => (
            <MobileEntryCard key={e.id} entry={e} showDate={true} />
          ))}
        </MobileSection>

        <MobileSection
          title="My other jobs"
          emptyHint="No unscheduled jobs assigned to you."
          subtitle={myUnscheduledJobs.length > 0 ? "Assigned to you, not yet booked" : undefined}
        >
          {myUnscheduledJobs.map((j: any) => (
            <Link
              key={j.id}
              href={`/jobs/${j.id}`}
              className="block rounded-lg border border-border bg-card p-4 active:bg-accent/40 transition-colors"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-mono text-sm font-semibold">{j.number}</p>
                  <p className="text-sm text-muted-foreground truncate">{j.customer?.name ?? "—"}</p>
                </div>
                {j.status && (
                  <span
                    className="inline-flex shrink-0 items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-medium"
                    style={{ backgroundColor: `${j.status.colour}1f`, color: j.status.colour }}
                  >
                    <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: j.status.colour }} />
                    {j.status.name}
                  </span>
                )}
              </div>
            </Link>
          ))}
        </MobileSection>
      </div>

      {/* ── Desktop dashboard ── (admin / ops view, unchanged) */}
      <div className="hidden lg:block">
        <h1 className="text-3xl font-semibold tracking-tight">Dashboard</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {greeting} <span className="text-foreground font-medium">{displayName}</span>
        </p>

        {/* Filters */}
        <DashboardFilters
          staffList={staffListResult.data ?? []}
          categories={categoriesResult.data ?? []}
          currentStaff={params.staff}
          currentCategory={params.category}
        />

        {/* Stats */}
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard label="Active Jobs" value={String(filteredJobs.length)} href="/jobs" />
          <StatCard label="Customers" value={String(totalCustomers ?? 0)} href="/customers" />
          <StatCard label="Overdue" value={String(overdueJobs.length)} warning={overdueJobs.length > 0} />
          <StatCard
            label="Pipeline Value"
            value={`$${(pipelineDeals ?? []).reduce((sum: number, d: any) => sum + (d.value ?? 0), 0).toLocaleString("en-AU")}`}
            href="/pipeline"
          />
        </div>

        <div className="mt-8 grid gap-6 lg:grid-cols-2">
          {/* Recent Jobs */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-base font-semibold tracking-tight">Recent Jobs</h2>
              <Link href="/jobs" className="text-xs font-medium text-primary hover:text-primary/80 transition-colors">View all →</Link>
            </div>
            <div className="surface-card overflow-hidden">
              {recentJobs.length > 0 ? (
                recentJobs.map((job: any) => (
                  <Link
                    key={job.id}
                    href={`/jobs/${job.id}`}
                    className="group flex items-center justify-between border-b border-border last:border-0 px-4 py-3 transition-colors hover:bg-accent/40"
                  >
                    <div className="min-w-0">
                      <span className="font-mono text-sm font-semibold text-foreground">{job.number}</span>
                      <span className="ml-2 text-sm text-muted-foreground truncate">{job.customer?.name}</span>
                    </div>
                    {job.status && (
                      <span
                        className="inline-flex shrink-0 items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium"
                        style={{ backgroundColor: `${job.status.colour}1f`, color: job.status.colour }}
                      >
                        <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: job.status.colour }} />
                        {job.status.name}
                      </span>
                    )}
                  </Link>
                ))
              ) : (
                <div className="px-4 py-10 text-center text-sm text-muted-foreground">
                  {params.staff || params.category ? "No jobs match the current filters." : "No active jobs — looking quiet today."}
                </div>
              )}
            </div>
          </div>

          {/* Today's Schedule */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-base font-semibold tracking-tight">Today&apos;s Schedule</h2>
              <Link href="/scheduler" className="text-xs font-medium text-primary hover:text-primary/80 transition-colors">Full schedule →</Link>
            </div>
            <div className="surface-card overflow-hidden">
              {filteredSchedule.length > 0 ? (
                filteredSchedule.map((entry: any) => (
                  <Link
                    key={entry.id}
                    href={`/jobs/${entry.job?.id}`}
                    className="group flex items-center justify-between border-b border-border last:border-0 px-4 py-3 transition-colors hover:bg-accent/40"
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      {entry.staff && (
                        <span
                          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold text-white ring-1 ring-white/10"
                          style={{ backgroundColor: entry.staff.colour ?? "#3b82f6" }}
                        >
                          {entry.staff.initials}
                        </span>
                      )}
                      <div className="min-w-0">
                        <span className="font-mono text-sm font-semibold text-foreground">{entry.job?.number}</span>
                        <span className="ml-2 text-sm text-muted-foreground">
                          {entry.job?.customer?.name}{entry.job?.site ? ` · ${entry.job.site.name}` : ""}
                        </span>
                      </div>
                    </div>
                    <span className="font-mono text-xs text-muted-foreground tabular-nums">
                      {entry.start_time && entry.end_time ? `${entry.start_time.slice(0, 5)} – ${entry.end_time.slice(0, 5)}` : "All day"}
                    </span>
                  </Link>
                ))
              ) : (
                <div className="px-4 py-10 text-center text-sm text-muted-foreground">Nothing on today.</div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function MobileSection({
  title,
  subtitle,
  emptyHint,
  children,
}: {
  title: string;
  subtitle?: string;
  emptyHint: string;
  children: React.ReactNode;
}) {
  const isEmpty =
    !children ||
    (Array.isArray(children) && children.filter(Boolean).length === 0);
  return (
    <section className="mt-6">
      <div className="flex items-baseline justify-between mb-2.5">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          {title}
        </h2>
        {subtitle && <span className="text-[10px] text-muted-foreground">{subtitle}</span>}
      </div>
      {isEmpty ? (
        <p className="rounded-lg border border-dashed border-border bg-card/40 px-4 py-6 text-center text-xs text-muted-foreground italic">
          {emptyHint}
        </p>
      ) : (
        <div className="space-y-2">{children}</div>
      )}
    </section>
  );
}

function MobileEntryCard({ entry, showDate }: { entry: any; showDate: boolean }) {
  const isJob = (entry.entry_type ?? "job") === "job";
  const timeLabel =
    entry.start_time && entry.end_time
      ? `${entry.start_time.slice(0, 5)} – ${entry.end_time.slice(0, 5)}`
      : "All day";
  const dateLabel = showDate && entry.schedule_date
    ? new Date(entry.schedule_date + "T00:00:00").toLocaleDateString("en-AU", { weekday: "short", day: "numeric", month: "short" })
    : null;

  // Job entries deep-link straight to the job page; events/reminders fall
  // back to the scheduler for editing since they don't have a job to open.
  const href = isJob && entry.job?.id ? `/jobs/${entry.job.id}` : "/scheduler";

  return (
    <Link
      href={href}
      className="block rounded-lg border border-border bg-card p-4 active:bg-accent/40 transition-colors"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2 flex-wrap">
            {isJob ? (
              <>
                <span className="font-mono text-sm font-semibold">{entry.job?.number ?? "—"}</span>
                <span className="text-xs text-muted-foreground">{timeLabel}</span>
              </>
            ) : (
              <>
                <span className="text-sm font-semibold">
                  {entry.entry_type === "reminder" ? "⏰ " : ""}{entry.title ?? "Untitled"}
                </span>
                <span className="text-xs text-muted-foreground">{timeLabel}</span>
              </>
            )}
          </div>
          <p className="mt-0.5 text-sm text-muted-foreground truncate">
            {isJob
              ? `${entry.job?.customer?.name ?? "—"}${entry.job?.site ? ` · ${entry.job.site.name}` : ""}`
              : entry.notes ?? ""}
          </p>
          {dateLabel && (
            <p className="mt-1 text-[10px] uppercase tracking-wider text-muted-foreground">{dateLabel}</p>
          )}
        </div>
        {entry.staff && (
          <span
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-white ring-1 ring-white/10"
            style={{ backgroundColor: entry.staff.colour ?? "#3b82f6" }}
          >
            {entry.staff.initials}
          </span>
        )}
      </div>
    </Link>
  );
}

function StatCard({ label, value, href, warning }: { label: string; value: string; href?: string; warning?: boolean }) {
  const baseClass = warning
    ? "border-destructive/30 bg-destructive/5 hover:border-destructive/50"
    : "border-border bg-card hover:border-border-strong";
  const content = (
    <div className={`surface-card card-hover relative overflow-hidden p-5 ${baseClass} ${href ? "cursor-pointer" : ""}`}>
      {warning && (
        <span className="pointer-events-none absolute right-3 top-3 inline-flex h-2 w-2 rounded-full bg-destructive/80 shadow-[0_0_12px] shadow-destructive/40" />
      )}
      <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className={`num-display mt-2 text-3xl font-semibold ${warning ? "text-destructive" : "num-gradient"}`}>
        {value}
      </p>
    </div>
  );
  return href ? <Link href={href}>{content}</Link> : content;
}

function isoDate(d: Date): string {
  return d.toISOString().split("T")[0];
}

function addDays(d: Date, n: number): Date {
  const out = new Date(d);
  out.setDate(out.getDate() + n);
  return out;
}

async function getCompletionStatusIds(supabase: any): Promise<string> {
  const { data } = await supabase.from("statuses").select("id").in("name", ["Complete", "Cancelled"]);
  return (data ?? []).map((s: any) => s.id).join(",");
}
