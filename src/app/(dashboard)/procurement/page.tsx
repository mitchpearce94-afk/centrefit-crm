import { createClient } from "@/lib/supabase/server";
import Link from "next/link";

type ItemRow = {
  job_id: string;
  status: string;
  xero_po_number: string | null;
};

type JobRow = {
  id: string;
  number: number | null;
  description: string | null;
  customer: { id: string; name: string } | null;
  site: { id: string; name: string | null } | null;
};

type QuoteRow = {
  id: string;
  ref: string;
  job_id: string;
  accepted_at: string | null;
};

export default async function ProcurementIndexPage() {
  const supabase = await createClient();

  const [itemsRes, jobsRes, acceptedQuotesRes] = await Promise.all([
    supabase
      .from("job_procurement_items")
      .select("job_id, status, xero_po_number"),
    supabase
      .from("jobs")
      .select("id, number, description, customer:customers(id, name), site:customer_sites(id, name)"),
    supabase
      .from("quotes")
      .select("id, ref, job_id, accepted_at")
      .eq("status", "accepted")
      .order("accepted_at", { ascending: false }),
  ]);

  const items = (itemsRes.data ?? []) as ItemRow[];
  const jobs = (jobsRes.data ?? []) as unknown as JobRow[];
  const acceptedQuotes = (acceptedQuotesRes.data ?? []) as QuoteRow[];

  const jobsById = new Map<string, JobRow>();
  for (const j of jobs) jobsById.set(j.id, j);

  // Summary stats per job based on procurement items
  type StatusKey = "pending" | "in_stock" | "order" | "ordered" | "received";
  type Stats = {
    pending: number;
    in_stock: number;
    order: number;
    ordered: number;
    received: number;
    total: number;
    poNumbers: Set<string>;
  };
  const statsByJob = new Map<string, Stats>();
  const KNOWN_STATUSES: StatusKey[] = ["pending", "in_stock", "order", "ordered", "received"];
  for (const it of items) {
    const s =
      statsByJob.get(it.job_id) ??
      ({
        pending: 0,
        in_stock: 0,
        order: 0,
        ordered: 0,
        received: 0,
        total: 0,
        poNumbers: new Set<string>(),
      } as Stats);
    if ((KNOWN_STATUSES as string[]).includes(it.status)) {
      s[it.status as StatusKey] += 1;
    }
    s.total += 1;
    if (it.xero_po_number) s.poNumbers.add(it.xero_po_number);
    statsByJob.set(it.job_id, s);
  }

  // Active jobs with procurement (most recently active first isn't tracked —
  // fall back to job number desc)
  const active = Array.from(statsByJob.keys())
    .map((jobId) => ({ job: jobsById.get(jobId)!, stats: statsByJob.get(jobId)! }))
    .filter((e) => !!e.job)
    .sort((a, b) => (b.job.number ?? 0) - (a.job.number ?? 0));

  // Jobs with accepted quote but NO procurement rows — ready to start
  const jobsWithProcurement = new Set(statsByJob.keys());
  const readyByJobId = new Map<string, QuoteRow>();
  for (const q of acceptedQuotes) {
    if (!q.job_id || jobsWithProcurement.has(q.job_id)) continue;
    if (!readyByJobId.has(q.job_id)) readyByJobId.set(q.job_id, q);
  }
  const ready = Array.from(readyByJobId.entries())
    .map(([jobId, quote]) => ({ job: jobsById.get(jobId)!, quote }))
    .filter((e) => !!e.job);

  // Global totals
  const totals = {
    jobs: active.length,
    pending: active.reduce((s, e) => s + e.stats.pending, 0),
    inStock: active.reduce((s, e) => s + e.stats.in_stock, 0),
    toOrder: active.reduce((s, e) => s + e.stats.order, 0),
    ordered: active.reduce((s, e) => s + e.stats.ordered, 0),
    received: active.reduce((s, e) => s + e.stats.received, 0),
    openPOs: new Set(active.flatMap((e) => Array.from(e.stats.poNumbers))).size,
  };

  return (
    <div>
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Procurement</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Stock ordering from accepted quotes. Warehouse picks + supplier draft POs, grouped by job.
        </p>
      </div>

      <div className="mt-5 grid grid-cols-2 sm:grid-cols-6 gap-3">
        <Stat label="Active jobs" value={totals.jobs} />
        <Stat label="Pending" value={totals.pending} tone="muted" />
        <Stat label="In stock" value={totals.inStock} tone="sky" />
        <Stat label="To order" value={totals.toOrder} tone="amber" />
        <Stat label="Ordered" value={totals.ordered} tone="indigo" />
        <Stat label="Received" value={totals.received} tone="emerald" />
      </div>

      {ready.length > 0 && (
        <section className="mt-6">
          <h2 className="text-sm font-semibold mb-2">Ready to start</h2>
          <p className="text-xs text-muted-foreground mb-3">
            Jobs with an accepted quote but no procurement started. Click into the job and hit
            Start Ordering.
          </p>
          <div className="rounded-lg border border-border bg-card overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border text-left bg-muted/30 text-muted-foreground">
                  <th className="px-3 py-2 font-medium">Job</th>
                  <th className="px-3 py-2 font-medium">Quote</th>
                  <th className="px-3 py-2 font-medium">Customer</th>
                  <th className="px-3 py-2 font-medium">Site</th>
                  <th className="px-3 py-2 font-medium text-right w-32">Accepted</th>
                </tr>
              </thead>
              <tbody>
                {ready.map(({ job, quote }) => (
                  <tr key={job.id} className="border-b border-border last:border-0 hover:bg-accent/30">
                    <td className="px-3 py-2 font-mono">
                      <Link href={`/procurement/${job.id}`} className="text-primary hover:underline">
                        CFA-{job.number ?? "?"}
                      </Link>
                    </td>
                    <td className="px-3 py-2 font-mono text-muted-foreground">{quote.ref}</td>
                    <td className="px-3 py-2">{job.customer?.name ?? "—"}</td>
                    <td className="px-3 py-2 text-muted-foreground">{job.site?.name ?? "—"}</td>
                    <td className="px-3 py-2 text-right text-muted-foreground">
                      {quote.accepted_at ? new Date(quote.accepted_at).toLocaleDateString() : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <section className="mt-6">
        <h2 className="text-sm font-semibold mb-2">Active procurement</h2>
        {active.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            No jobs have procurement started yet. Accept a quote and hit &ldquo;Start Ordering&rdquo;.
          </p>
        ) : (
          <div className="rounded-lg border border-border bg-card overflow-hidden">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-border text-left bg-muted/30 text-muted-foreground">
                  <th className="px-3 py-2 font-medium">Job</th>
                  <th className="px-3 py-2 font-medium">Customer · Site</th>
                  <th className="px-3 py-2 font-medium text-right w-16">Lines</th>
                  <th className="px-3 py-2 font-medium text-right w-20">In Stock</th>
                  <th className="px-3 py-2 font-medium text-right w-20">To Order</th>
                  <th className="px-3 py-2 font-medium text-right w-20">Ordered</th>
                  <th className="px-3 py-2 font-medium text-right w-20">Received</th>
                  <th className="px-3 py-2 font-medium text-right w-20">POs</th>
                </tr>
              </thead>
              <tbody>
                {active.map(({ job, stats }) => (
                  <tr key={job.id} className="border-b border-border last:border-0 hover:bg-accent/30">
                    <td className="px-3 py-2 font-mono">
                      <Link href={`/procurement/${job.id}`} className="text-primary hover:underline">
                        CFA-{job.number ?? "?"}
                      </Link>
                    </td>
                    <td className="px-3 py-2">
                      <div className="font-medium">{job.customer?.name ?? "—"}</div>
                      {job.site?.name && (
                        <div className="text-[10px] text-muted-foreground">{job.site.name}</div>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right font-mono">{stats.total}</td>
                    <td className="px-3 py-2 text-right font-mono text-sky-400">
                      {stats.in_stock || "—"}
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-amber-400">
                      {stats.order || "—"}
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-indigo-400">
                      {stats.ordered || "—"}
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-emerald-400">
                      {stats.received || "—"}
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-muted-foreground">
                      {stats.poNumbers.size || "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function Stat({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: number;
  tone?: "neutral" | "muted" | "sky" | "amber" | "indigo" | "emerald";
}) {
  const toneClass =
    tone === "sky"
      ? "text-sky-400"
      : tone === "amber"
        ? "text-amber-400"
        : tone === "indigo"
          ? "text-indigo-400"
          : tone === "emerald"
            ? "text-emerald-400"
            : tone === "muted"
              ? "text-muted-foreground"
              : "text-foreground";
  return (
    <div className="rounded-md border border-border bg-card px-3 py-2">
      <div className={`text-lg font-semibold ${toneClass}`}>{value}</div>
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
    </div>
  );
}
