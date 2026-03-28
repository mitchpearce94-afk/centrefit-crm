import { createClient } from "@/lib/supabase/server";
import Link from "next/link";

export default async function DashboardPage() {
  const supabase = await createClient();

  const [
    { data: { user } },
    { count: activeJobs },
    { count: totalCustomers },
    { data: recentJobs },
    { data: overdueJobs },
  ] = await Promise.all([
    supabase.auth.getUser(),
    supabase
      .from("jobs")
      .select("id", { count: "exact", head: true })
      .not("status_id", "in", `(${await getCompletionStatusIds(supabase)})`),
    supabase
      .from("customers")
      .select("id", { count: "exact", head: true })
      .eq("is_active", true),
    supabase
      .from("jobs")
      .select(
        "id, number, reference, customer:customers(name), status:statuses(name, colour), updated_at"
      )
      .order("updated_at", { ascending: false })
      .limit(5),
    supabase
      .from("jobs")
      .select(
        "id, number, reference, due_date, customer:customers(name), status:statuses(name, colour)"
      )
      .lt("due_date", new Date().toISOString().split("T")[0])
      .not("status_id", "in", `(${await getCompletionStatusIds(supabase)})`)
      .order("due_date")
      .limit(5),
  ]);

  const staffResult = await supabase
    .from("staff")
    .select("display_name")
    .eq("id", user?.id ?? "")
    .single();

  const displayName = staffResult.data?.display_name ?? user?.email ?? "";

  return (
    <div>
      <h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Welcome back, {displayName}
      </p>

      {/* Stats */}
      <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Active Jobs" value={String(activeJobs ?? 0)} href="/jobs" />
        <StatCard label="Customers" value={String(totalCustomers ?? 0)} href="/customers" />
        <StatCard label="Overdue" value={String(overdueJobs?.length ?? 0)} warning={(overdueJobs?.length ?? 0) > 0} />
        <StatCard label="Pipeline Value" value="—" />
      </div>

      <div className="mt-8 grid gap-8 lg:grid-cols-2">
        {/* Recent Jobs */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-lg font-semibold">Recent Jobs</h2>
            <Link href="/jobs" className="text-sm text-primary hover:text-primary/80 transition-colors">
              View all
            </Link>
          </div>
          <div className="rounded-lg border border-border overflow-hidden">
            {recentJobs && recentJobs.length > 0 ? (
              recentJobs.map((job: any) => (
                <Link
                  key={job.id}
                  href={`/jobs/${job.id}`}
                  className="flex items-center justify-between border-b border-border last:border-0 px-4 py-3 hover:bg-muted/30 transition-colors"
                >
                  <div>
                    <span className="font-mono text-sm font-medium">
                      {job.number}
                    </span>
                    <span className="ml-2 text-sm text-muted-foreground">
                      {job.customer?.name}
                    </span>
                  </div>
                  {job.status && (
                    <span
                      className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium"
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
                </Link>
              ))
            ) : (
              <div className="px-4 py-8 text-center text-sm text-muted-foreground">
                No jobs yet.{" "}
                <Link href="/jobs/new" className="text-primary hover:underline">
                  Create your first job
                </Link>
              </div>
            )}
          </div>
        </div>

        {/* Overdue Jobs */}
        <div>
          <h2 className="text-lg font-semibold mb-3">Overdue</h2>
          <div className="rounded-lg border border-border overflow-hidden">
            {overdueJobs && overdueJobs.length > 0 ? (
              overdueJobs.map((job: any) => (
                <Link
                  key={job.id}
                  href={`/jobs/${job.id}`}
                  className="flex items-center justify-between border-b border-border last:border-0 px-4 py-3 hover:bg-muted/30 transition-colors"
                >
                  <div>
                    <span className="font-mono text-sm font-medium">
                      {job.number}
                    </span>
                    <span className="ml-2 text-sm text-muted-foreground">
                      {job.customer?.name}
                    </span>
                  </div>
                  <span className="text-xs text-destructive font-medium">
                    Due{" "}
                    {new Date(job.due_date).toLocaleDateString("en-AU")}
                  </span>
                </Link>
              ))
            ) : (
              <div className="px-4 py-8 text-center text-sm text-muted-foreground">
                Nothing overdue. Nice one.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
  href,
  warning,
}: {
  label: string;
  value: string;
  href?: string;
  warning?: boolean;
}) {
  const content = (
    <div
      className={`rounded-lg border p-5 transition-colors ${
        warning
          ? "border-destructive/30 bg-destructive/5"
          : "border-border bg-card"
      } ${href ? "hover:bg-muted/50 cursor-pointer" : ""}`}
    >
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className={`mt-1 text-2xl font-semibold ${warning ? "text-destructive" : ""}`}>
        {value}
      </p>
    </div>
  );

  return href ? <Link href={href}>{content}</Link> : content;
}

// Helper to get completion status IDs for excluding completed/cancelled jobs
async function getCompletionStatusIds(supabase: any): Promise<string> {
  const { data } = await supabase
    .from("statuses")
    .select("id")
    .in("name", ["Complete", "Cancelled"]);
  return (data ?? []).map((s: any) => s.id).join(",");
}
