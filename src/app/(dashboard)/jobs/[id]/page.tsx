import { createClient } from "@/lib/supabase/server";
import { notFound } from "next/navigation";
import Link from "next/link";
import { StatusTransition } from "./status-transition";
import { QuickActions } from "./quick-actions";
import { JobChecklist } from "./job-checklist";
import { WorkLog } from "./work-log";
import { JobTabs } from "./job-tabs";

export default async function JobDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const [jobResult, statusesResult, staffResult, workResult, notesResult, timeResult, nbnResult, checklistResult, templatesResult] =
    await Promise.all([
      supabase
        .from("jobs")
        .select(
          "*, customer:customers(id, name), site:customer_sites(id, name, address, suburb, state, postcode), status:statuses(*), category_1:categories!category_1_id(id, name), category_2:categories!category_2_id(id, name), job_staff(id, role, staff:staff(id, display_name, initials, colour, email, phone))"
        )
        .eq("id", id)
        .single(),
      supabase.from("statuses").select("*").order("sort_order"),
      supabase
        .from("staff")
        .select("id, display_name, initials, colour")
        .eq("is_active", true),
      supabase
        .from("job_work_entries")
        .select("*, staff:staff(display_name, initials, colour)")
        .eq("job_id", id)
        .order("work_date", { ascending: false }),
      supabase
        .from("job_notes")
        .select("*, staff:staff(display_name, initials, colour)")
        .eq("job_id", id)
        .order("created_at", { ascending: false }),
      supabase
        .from("job_time")
        .select("*, staff:staff(display_name, initials, colour)")
        .eq("job_id", id)
        .order("start_time", { ascending: false }),
      supabase
        .from("nbn_steps")
        .select("*")
        .eq("job_id", id)
        .order("step_number"),
      supabase
        .from("job_checklist_items")
        .select("*")
        .eq("job_id", id)
        .order("sort_order"),
      supabase
        .from("checklist_templates")
        .select("*")
        .eq("is_active", true)
        .order("name"),
    ]);

  if (jobResult.error || !jobResult.data) {
    notFound();
  }

  const job = jobResult.data;
  const isNbnJob = job.category_1?.name?.includes("NBN") ?? false;
  const hasOpenTimer = (timeResult.data ?? []).some((t: any) => !t.end_time);

  return (
    <div>
      {/* ── Header ── */}
      <div className="flex items-center gap-2 text-sm">
        <Link
          href="/jobs"
          className="text-muted-foreground hover:text-foreground transition-colors"
        >
          Jobs
        </Link>
        <span className="text-muted-foreground">/</span>
      </div>

      <div className="mt-1 flex items-center gap-3 flex-wrap">
        <h1 className="text-2xl font-bold tracking-tight font-mono">
          {job.number}
        </h1>
        <StatusTransition
          jobId={id}
          currentStatus={job.status as any}
          allStatuses={statusesResult.data ?? []}
        />
      </div>

      {/* ── Job metadata row ── */}
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
        <Link
          href={`/customers/${job.customer?.id}`}
          className="font-medium text-foreground hover:text-primary transition-colors"
        >
          {job.customer?.name}
        </Link>
        {job.site && (
          <>
            <span className="text-muted-foreground">·</span>
            <span className="text-muted-foreground">{job.site.name}</span>
          </>
        )}
        {job.site?.address && (
          <span className="text-xs text-muted-foreground">
            ({[job.site.address, job.site.suburb, job.site.state].filter(Boolean).join(", ")})
          </span>
        )}
      </div>

      {/* ── Categories + Staff ── */}
      <div className="mt-2 flex flex-wrap items-center gap-2">
        {job.category_1 && (
          <span className="rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium text-muted-foreground">
            {job.category_1.name}
          </span>
        )}
        {job.category_2 && (
          <span className="rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-medium text-primary">
            {job.category_2.name}
          </span>
        )}
        {job.job_staff?.length > 0 && (
          <>
            <span className="text-muted-foreground mx-1">·</span>
            <div className="flex -space-x-1">
              {job.job_staff.map((js: any) => (
                <span
                  key={js.id}
                  className="flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-medium text-white ring-2 ring-background"
                  style={{ backgroundColor: js.staff?.colour ?? "#3b82f6" }}
                  title={js.staff?.display_name}
                >
                  {js.staff?.initials}
                </span>
              ))}
            </div>
          </>
        )}
      </div>

      {/* ── Quick Actions ── */}
      <QuickActions
        jobId={id}
        hasOpenTimer={hasOpenTimer}
        openTimerId={(timeResult.data ?? []).find((t: any) => !t.end_time)?.id}
        allStatuses={statusesResult.data ?? []}
        currentStatusName={(job.status as any)?.name}
      />

      {/* ── Description (read-only scope) ── */}
      {job.description && (
        <div className="mt-5">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">
            Scope / Description
          </h2>
          <div className="rounded-lg border border-border bg-card p-4 text-sm whitespace-pre-wrap">
            {job.description}
          </div>
        </div>
      )}
      {job.reference && (
        <p className="mt-2 text-xs text-muted-foreground">
          Ref: {job.reference}
        </p>
      )}

      {/* ── Checklist ── */}
      <div className="mt-6">
        <JobChecklist
          jobId={id}
          items={(checklistResult.data ?? []) as any}
          templates={(templatesResult.data ?? []) as any}
        />
      </div>

      {/* ── Work Log (additional work not in checklist) ── */}
      <div className="mt-6">
        <WorkLog jobId={id} entries={workResult.data ?? []} />
      </div>

      {/* ── Tabs: Notes, Time, Staff, NBN ── */}
      <div className="mt-8">
        <JobTabs
          jobId={id}
          job={job}
          notes={notesResult.data ?? []}
          timeEntries={timeResult.data ?? []}
          nbnSteps={nbnResult.data ?? []}
          allStaff={staffResult.data ?? []}
          isNbnJob={isNbnJob}
        />
      </div>
    </div>
  );
}
