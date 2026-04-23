import { createClient } from "@/lib/supabase/server";
import { notFound } from "next/navigation";
import Link from "next/link";
import { JobProcurement } from "../../jobs/[id]/job-procurement";

export default async function ProcurementJobPage({
  params,
}: {
  params: Promise<{ jobId: string }>;
}) {
  const { jobId } = await params;
  const supabase = await createClient();

  const [jobResult, procurementResult, suppliersResult, quoteResult] = await Promise.all([
    supabase
      .from("jobs")
      .select(
        "id, number, description, customer:customers(id, name), site:customer_sites(id, name, address, suburb, state, postcode)",
      )
      .eq("id", jobId)
      .single(),
    supabase
      .from("job_procurement_items")
      .select(
        "*, received_by_staff:staff!job_procurement_items_received_by_fkey(display_name)",
      )
      .eq("job_id", jobId)
      .order("created_at", { ascending: true })
      .order("id", { ascending: true }),
    supabase
      .from("suppliers")
      .select("id, name")
      .eq("is_active", true)
      .order("name"),
    supabase
      .from("quotes")
      .select("id, ref, status, accepted_at")
      .eq("job_id", jobId)
      .eq("status", "accepted")
      .order("accepted_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  if (jobResult.error || !jobResult.data) notFound();
  const job = jobResult.data as unknown as {
    id: string;
    number: number | null;
    description: string | null;
    customer: { id: string; name: string } | null;
    site: { name: string | null; address: string | null; suburb: string | null; state: string | null; postcode: string | null } | null;
  };
  const quote = quoteResult.data as { ref: string; accepted_at: string | null } | null;

  const siteLine = job.site
    ? [job.site.name, job.site.address, job.site.suburb, job.site.state, job.site.postcode]
        .filter(Boolean)
        .join(" · ")
    : null;

  return (
    <div>
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Link href="/procurement" className="hover:text-foreground">Procurement</Link>
            <span>/</span>
            <span>CFA-{job.number ?? "?"}</span>
          </div>
          <h1 className="mt-1 text-2xl font-bold tracking-tight">
            Procurement · CFA-{job.number ?? "?"}
          </h1>
          <div className="mt-1 text-sm text-muted-foreground">
            {job.customer?.name ?? "—"}
            {siteLine && ` · ${siteLine}`}
          </div>
          {quote && (
            <div className="mt-1 text-xs text-muted-foreground">
              Quote <span className="font-mono">{quote.ref}</span>
              {quote.accepted_at && ` · accepted ${new Date(quote.accepted_at).toLocaleDateString()}`}
            </div>
          )}
        </div>
        <Link
          href={`/jobs/${jobId}`}
          className="shrink-0 rounded-md border border-border px-3 py-2 text-xs text-muted-foreground hover:bg-accent"
        >
          Open job →
        </Link>
      </div>

      <div className="mt-5">
        <JobProcurement
          jobId={jobId}
          items={(procurementResult.data ?? []) as never[]}
          suppliers={(suppliersResult.data ?? []) as never[]}
        />
      </div>
    </div>
  );
}
