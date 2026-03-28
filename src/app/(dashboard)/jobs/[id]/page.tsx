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

  const [jobResult, statusesResult, staffResult, categoriesResult, notesResult, timeResult, nbnResult] =
    await Promise.all([
      supabase
        .from("jobs")
        .select(
          "*, customer:customers(id, name), site:customer_sites(id, name, address, suburb, state, postcode), status:statuses(*), category_1:categories!category_1_id(id, name, type), category_2:categories!category_2_id(id, name, type), job_staff(id, role, staff:staff(id, display_name, initials, colour, email, phone)), created_by_staff:staff!created_by(display_name)"
        )
        .eq("id", id)
        .single(),
      supabase.from("statuses").select("*").order("sort_order"),
      supabase
        .from("staff")
        .select("id, display_name, initials, colour")
        .eq("is_active", true),
      supabase
        .from("categories")
        .select("*")
        .eq("is_active", true)
        .order("sort_order"),
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
    ]);

  if (jobResult.error || !jobResult.data) {
    notFound();
  }

  const job = jobResult.data;

  return (
    <div>
      {/* Header */}
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

      {/* Assigned staff */}
      {job.job_staff?.length > 0 && (
        <div className="mt-3 flex items-center gap-1.5">
          <span className="text-xs text-muted-foreground mr-1">Assigned:</span>
          <div className="flex -space-x-1">
            {job.job_staff.map((js: any) => (
              <span
                key={js.id}
                className="flex h-7 w-7 items-center justify-center rounded-full text-[10px] font-medium text-white ring-2 ring-background"
                style={{ backgroundColor: js.staff?.colour ?? "#3b82f6" }}
                title={js.staff?.display_name}
              >
                {js.staff?.initials}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="mt-5">
        <JobDetailTabs
          jobId={id}
          job={job}
          notes={notesResult.data ?? []}
          timeEntries={timeResult.data ?? []}
          nbnSteps={nbnResult.data ?? []}
          allStaff={staffResult.data ?? []}
          categories={categoriesResult.data ?? []}
        />
      </div>
    </div>
  );
}
