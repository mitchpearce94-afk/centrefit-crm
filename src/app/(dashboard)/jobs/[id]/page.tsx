import { createClient } from "@/lib/supabase/server";
import { notFound } from "next/navigation";
import Link from "next/link";
import { JobDetailTabs } from "./job-detail-tabs";
import { StatusTransition } from "./status-transition";

export default async function JobDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const [jobResult, statusesResult, staffResult, notesResult, timeResult] =
    await Promise.all([
      supabase
        .from("jobs")
        .select(
          "*, customer:customers(id, name), site:customer_sites(id, name, address, suburb, state, postcode), status:statuses(*), category_1:categories!category_1_id(id, name), category_2:categories!category_2_id(id, name), job_staff(id, role, staff:staff(id, display_name, initials, colour, email, phone)), created_by_staff:staff!created_by(display_name)"
        )
        .eq("id", id)
        .single(),
      supabase.from("statuses").select("*").order("sort_order"),
      supabase
        .from("staff")
        .select("id, display_name, initials, colour")
        .eq("is_active", true),
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
    ]);

  if (jobResult.error || !jobResult.data) {
    notFound();
  }

  const job = jobResult.data;

  return (
    <div>
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2 text-sm">
            <Link
              href="/jobs"
              className="text-muted-foreground hover:text-foreground transition-colors"
            >
              Jobs
            </Link>
            <span className="text-muted-foreground">/</span>
          </div>
          <div className="mt-1 flex items-center gap-3">
            <h1 className="text-2xl font-bold tracking-tight font-mono">
              {job.number}
            </h1>
            <StatusTransition
              jobId={id}
              currentStatus={job.status as any}
              allStatuses={statusesResult.data ?? []}
            />
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
            <Link
              href={`/customers/${job.customer?.id}`}
              className="hover:text-primary transition-colors"
            >
              {job.customer?.name}
            </Link>
            {job.site && (
              <>
                <span>·</span>
                <span>{job.site.name}</span>
              </>
            )}
            {job.reference && (
              <>
                <span>·</span>
                <span>{job.reference}</span>
              </>
            )}
            {job.category_1 && (
              <>
                <span>·</span>
                <span>{job.category_1.name}</span>
              </>
            )}
            {job.category_2 && (
              <span className="rounded bg-muted px-1.5 py-0.5 text-xs">
                {job.category_2.name}
              </span>
            )}
          </div>
        </div>
        <Link
          href={`/jobs/${id}/edit`}
          className="rounded-md border border-border px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          Edit
        </Link>
      </div>

      {/* Summary cards */}
      <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <SummaryCard
          label="Estimated Value"
          value={
            job.estimated_value
              ? `$${Number(job.estimated_value).toLocaleString()}`
              : "—"
          }
        />
        <SummaryCard
          label="Due Date"
          value={
            job.due_date
              ? new Date(job.due_date).toLocaleDateString("en-AU")
              : "—"
          }
        />
        <SummaryCard
          label="Staff Assigned"
          value={`${job.job_staff?.length ?? 0}`}
        />
        <SummaryCard
          label="Created"
          value={new Date(job.created_at).toLocaleDateString("en-AU")}
        />
      </div>

      {/* Tabs */}
      <div className="mt-6">
        <JobDetailTabs
          jobId={id}
          job={job}
          notes={notesResult.data ?? []}
          timeEntries={timeResult.data ?? []}
          allStaff={staffResult.data ?? []}
        />
      </div>
    </div>
  );
}

function SummaryCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-0.5 text-lg font-semibold">{value}</p>
    </div>
  );
}
