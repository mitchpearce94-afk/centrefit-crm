import { createClient } from "@/lib/supabase/server";
import Link from "next/link";
import { JobFilters } from "./job-filters";

export default async function JobsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; phase?: string; status?: string; category?: string }>;
}) {
  const params = await searchParams;
  const supabase = await createClient();

  // Fetch statuses and categories for filters
  const [statusesResult, categoriesResult] = await Promise.all([
    supabase.from("statuses").select("*").order("sort_order"),
    supabase.from("categories").select("*").eq("is_active", true).order("sort_order"),
  ]);

  let query = supabase
    .from("jobs")
    .select(
      "*, customer:customers(id, name), site:customer_sites(id, name), status:statuses(id, name, colour, phase), category_1:categories!category_1_id(id, name), category_2:categories!category_2_id(id, name), job_staff(staff:staff(id, display_name, initials, colour))"
    )
    .order("created_at", { ascending: false })
    .limit(100);

  if (params.q) {
    query = query.or(
      `number.ilike.%${params.q}%,reference.ilike.%${params.q}%,description.ilike.%${params.q}%`
    );
  }
  if (params.status) {
    query = query.eq("status_id", params.status);
  }
  if (params.category) {
    query = query.or(
      `category_1_id.eq.${params.category},category_2_id.eq.${params.category}`
    );
  }

  const { data: jobs, error } = await query;

  if (error) {
    return (
      <div className="text-destructive">
        Error loading jobs: {error.message}
      </div>
    );
  }

  // Phase filter — applied client-side via the status phase
  const filteredJobs = params.phase
    ? jobs?.filter((j: any) => j.status?.phase === params.phase)
    : jobs;

  const statuses = statusesResult.data ?? [];
  const categories = categoriesResult.data ?? [];

  return (
    <div>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Jobs</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {filteredJobs?.length ?? 0} jobs
          </p>
        </div>
        <Link
          href="/jobs/new"
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
        >
          New Job
        </Link>
      </div>

      <JobFilters
        statuses={statuses}
        categories={categories}
        defaultQuery={params.q}
        defaultPhase={params.phase}
        defaultStatus={params.status}
        defaultCategory={params.category}
      />

      <div className="mt-4 overflow-hidden rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/50">
              <th className="px-4 py-3 text-left font-medium text-muted-foreground">
                Job #
              </th>
              <th className="px-4 py-3 text-left font-medium text-muted-foreground">
                Customer
              </th>
              <th className="px-4 py-3 text-left font-medium text-muted-foreground hidden sm:table-cell">
                Reference
              </th>
              <th className="px-4 py-3 text-left font-medium text-muted-foreground">
                Status
              </th>
              <th className="px-4 py-3 text-left font-medium text-muted-foreground hidden md:table-cell">
                Category
              </th>
              <th className="px-4 py-3 text-left font-medium text-muted-foreground hidden lg:table-cell">
                Assigned
              </th>
              <th className="px-4 py-3 text-right font-medium text-muted-foreground hidden md:table-cell">
                Created
              </th>
            </tr>
          </thead>
          <tbody>
            {filteredJobs?.map((job: any) => (
              <tr
                key={job.id}
                className="border-b border-border last:border-0 transition-colors hover:bg-muted/30"
              >
                <td className="px-4 py-3">
                  <Link
                    href={`/jobs/${job.id}`}
                    className="font-mono font-medium text-foreground hover:text-primary transition-colors"
                  >
                    {job.number}
                  </Link>
                </td>
                <td className="px-4 py-3">
                  <Link
                    href={`/customers/${job.customer?.id}`}
                    className="text-foreground hover:text-primary transition-colors"
                  >
                    {job.customer?.name ?? "—"}
                  </Link>
                  {job.site && (
                    <span className="block text-xs text-muted-foreground">
                      {job.site.name}
                    </span>
                  )}
                </td>
                <td className="px-4 py-3 text-muted-foreground hidden sm:table-cell max-w-[200px] truncate">
                  {job.reference || job.description?.slice(0, 60) || "—"}
                </td>
                <td className="px-4 py-3">
                  {job.status && (
                    <span
                      className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium"
                      style={{
                        backgroundColor: `${job.status.colour}20`,
                        color: job.status.colour,
                      }}
                    >
                      <span
                        className="h-1.5 w-1.5 rounded-full"
                        style={{ backgroundColor: job.status.colour }}
                      />
                      {job.status.name}
                    </span>
                  )}
                </td>
                <td className="px-4 py-3 text-muted-foreground hidden md:table-cell">
                  {job.category_1?.name ?? "—"}
                </td>
                <td className="px-4 py-3 hidden lg:table-cell">
                  <div className="flex -space-x-1">
                    {job.job_staff?.map((js: any) => (
                      <span
                        key={js.staff?.id}
                        className="flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-medium text-white ring-2 ring-card"
                        style={{ backgroundColor: js.staff?.colour ?? "#3b82f6" }}
                        title={js.staff?.display_name}
                      >
                        {js.staff?.initials}
                      </span>
                    ))}
                    {(!job.job_staff || job.job_staff.length === 0) && (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </div>
                </td>
                <td className="px-4 py-3 text-right text-muted-foreground hidden md:table-cell">
                  {new Date(job.created_at).toLocaleDateString("en-AU")}
                </td>
              </tr>
            ))}
            {(!filteredJobs || filteredJobs.length === 0) && (
              <tr>
                <td
                  colSpan={7}
                  className="px-4 py-12 text-center text-muted-foreground"
                >
                  No jobs found.{" "}
                  <Link href="/jobs/new" className="text-primary hover:underline">
                    Create your first job
                  </Link>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
