import { createClient } from "@/lib/supabase/server";
import { notFound } from "next/navigation";
import Link from "next/link";
import { StatusTransition } from "./status-transition";
import { JobTabs } from "./job-tabs";

export default async function JobDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const [jobResult, statusesResult, staffResult, workResult, notesResult, timeResult, nbnResult, checklistResult, templatesResult, scheduleResult] =
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
      supabase
        .from("schedule_entries")
        .select("id, schedule_date, start_time, end_time, notes, staff_id, staff:staff!schedule_entries_staff_id_fkey(display_name, initials, colour)")
        .eq("job_id", id)
        .order("schedule_date", { ascending: false })
        .limit(10),
    ]);

  if (jobResult.error || !jobResult.data) {
    notFound();
  }

  const job = jobResult.data;
  const isNbnJob = job.category_1?.name?.includes("NBN") ?? false;
  const hasOpenTimer = (timeResult.data ?? []).some((t: any) => !t.end_time);

  return (
    <div>
      {/* ── Compact header ── */}
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

      {/* ── Full tab interface ── */}
      <div className="mt-4">
        <JobTabs
          jobId={id}
          job={job}
          allStatuses={statusesResult.data ?? []}
          allStaff={staffResult.data ?? []}
          notes={notesResult.data ?? []}
          timeEntries={timeResult.data ?? []}
          nbnSteps={nbnResult.data ?? []}
          workEntries={workResult.data ?? []}
          checklistItems={(checklistResult.data ?? []) as any}
          templates={(templatesResult.data ?? []) as any}
          isNbnJob={isNbnJob}
          hasOpenTimer={hasOpenTimer}
          openTimerId={(timeResult.data ?? []).find((t: any) => !t.end_time)?.id}
          scheduleEntries={scheduleResult.data ?? []}
        />
      </div>
    </div>
  );
}
