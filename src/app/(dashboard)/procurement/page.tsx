import { createClient } from "@/lib/supabase/server";
import { ProcurementBoard, type ReadyEntry, type ActiveEntry } from "./procurement-board";

type ItemRow = {
  job_id: string;
  status: string;
  xero_po_number: string | null;
};

type JobRow = {
  id: string;
  number: string | number | null;
  description: string | null;
  procurement_not_required: boolean | null;
  customer: { id: string; name: string } | null;
  site: { id: string; name: string | null } | null;
};

type QuoteRow = {
  id: string;
  ref: string;
  job_id: string;
  accepted_at: string | null;
  quote_type: string | null;
  pricing_snapshot: { totalExGST?: number } | null;
};

// Progress (PP1/PP2) jobs under this value still go straight to procurement on
// acceptance rather than waiting for the PP1 payment — small jobs aren't worth
// stalling. Mitchell's call, 2026-06-04.
const STRAIGHT_THROUGH_UNDER = 1000;

export default async function ProcurementIndexPage() {
  const supabase = await createClient();

  const [itemsRes, jobsRes, acceptedQuotesRes, paidPp1Res] = await Promise.all([
    supabase
      .from("job_procurement_items")
      .select("job_id, status, xero_po_number"),
    supabase
      .from("jobs")
      .select("id, number, description, procurement_not_required, customer:customers(id, name), site:customer_sites(id, name)"),
    supabase
      .from("quotes")
      .select("id, ref, job_id, accepted_at, quote_type, pricing_snapshot")
      .eq("status", "accepted")
      .order("accepted_at", { ascending: false }),
    // Progress jobs only enter procurement once PP1 is actually paid.
    supabase
      .from("invoices")
      .select("quote_id")
      .eq("invoice_type", "progress_pp1")
      .eq("status", "paid"),
  ]);

  const items = (itemsRes.data ?? []) as ItemRow[];
  const jobs = (jobsRes.data ?? []) as unknown as JobRow[];
  const acceptedQuotes = (acceptedQuotesRes.data ?? []) as QuoteRow[];
  const pp1PaidQuoteIds = new Set(
    ((paidPp1Res.data ?? []) as { quote_id: string | null }[])
      .map((r) => r.quote_id)
      .filter((v): v is string => !!v),
  );

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

  // Active jobs with procurement → flat, serializable entries (job number desc)
  const active = Array.from(statsByJob.keys())
    .map((jobId) => ({ job: jobsById.get(jobId)!, stats: statsByJob.get(jobId)! }))
    // Honour "removed from procurement" everywhere — a flagged job leaves the
    // Needs-work / Complete tabs too, not just Ready (it's restorable below).
    .filter((e) => !!e.job && !e.job.procurement_not_required)
    .sort((a, b) => String(b.job.number ?? "").localeCompare(String(a.job.number ?? "")));

  const activeEntries: ActiveEntry[] = active.map(({ job, stats }) => ({
    jobId: job.id,
    number: job.number,
    customerName: job.customer?.name ?? "—",
    siteName: job.site?.name ?? null,
    total: stats.total,
    inStock: stats.in_stock,
    order: stats.order,
    ordered: stats.ordered,
    received: stats.received,
    poCount: stats.poNumbers.size,
  }));

  // "Needs work" = anything still to triage or order. "Awaiting delivery" =
  // everything actioned but at least one ordered line hasn't been received yet
  // (Lily 2026-07-01: ordered ≠ complete until the stock actually arrives).
  // "Complete" = every line received or fulfilled from stock (nothing
  // actionable), so finished jobs drop out of the working view.
  const entryById = new Map(activeEntries.map((e) => [e.jobId, e]));
  const needsWork = active
    .filter(({ stats }) => stats.pending + stats.order > 0)
    .map(({ job }) => entryById.get(job.id)!);
  const awaitingDelivery = active
    .filter(({ stats }) => stats.pending + stats.order === 0 && stats.ordered > 0)
    .map(({ job }) => entryById.get(job.id)!);
  const complete = active
    .filter(({ stats }) => stats.total > 0 && stats.pending + stats.order + stats.ordered === 0)
    .map(({ job }) => entryById.get(job.id)!);

  // Jobs with accepted quote but NO procurement rows — ready to start.
  // Progress (PP1/PP2) jobs are held back until PP1 is paid; everything else
  // (full quotes, service jobs, and small progress jobs) goes straight through.
  const jobsWithProcurement = new Set(statsByJob.keys());
  const readyByJobId = new Map<string, QuoteRow>();
  // Jobs explicitly marked "no procurement needed" (labour-only / nothing to
  // order). Kept aside so they leave the Ready list but can still be restored.
  const dismissedByJobId = new Map<string, QuoteRow>();
  for (const q of acceptedQuotes) {
    if (!q.job_id || jobsWithProcurement.has(q.job_id)) continue;
    if (readyByJobId.has(q.job_id) || dismissedByJobId.has(q.job_id)) continue;

    if (jobsById.get(q.job_id)?.procurement_not_required) {
      dismissedByJobId.set(q.job_id, q);
      continue;
    }

    const isProgress = q.quote_type === "progress";
    if (isProgress) {
      // Hold a progress job back for its PP1 deposit ONLY when we can confirm
      // it's a big job (total >= $1000). A small job (< $1000) OR one whose
      // snapshot total is missing/0 goes straight through — Mitchell 2026-06-30:
      // never hide an under-$1000 (or unknown-total) job behind the deposit gate.
      const total = Number(q.pricing_snapshot?.totalExGST ?? 0);
      const straightThrough = total < STRAIGHT_THROUGH_UNDER;
      if (!straightThrough && !pp1PaidQuoteIds.has(q.id)) continue; // waiting on PP1
    }
    readyByJobId.set(q.job_id, q);
  }
  const toReadyEntry = (jobId: string, quote: QuoteRow): ReadyEntry | null => {
    const job = jobsById.get(jobId);
    if (!job) return null;
    return {
      jobId: job.id,
      number: job.number,
      customerName: job.customer?.name ?? "—",
      siteName: job.site?.name ?? null,
      quoteRef: quote.ref,
      acceptedAt: quote.accepted_at,
    };
  };
  const readyEntries: ReadyEntry[] = Array.from(readyByJobId.entries())
    .map(([jobId, quote]) => toReadyEntry(jobId, quote))
    .filter((e): e is ReadyEntry => !!e);
  const dismissedEntries: ReadyEntry[] = Array.from(dismissedByJobId.entries())
    .map(([jobId, quote]) => toReadyEntry(jobId, quote))
    .filter((e): e is ReadyEntry => !!e);
  // Jobs that DO have procurement rows but were removed from the board via the
  // flag — surface them in the same restorable list so a removal isn't a dead end.
  const removedWithRows: ReadyEntry[] = Array.from(statsByJob.keys())
    .map((jobId) => jobsById.get(jobId))
    .filter((j): j is NonNullable<typeof j> => !!j && !!j.procurement_not_required)
    .map((j) => ({
      jobId: j.id,
      number: j.number,
      customerName: j.customer?.name ?? "—",
      siteName: j.site?.name ?? null,
      quoteRef: "—",
      acceptedAt: null,
    }));
  const allDismissed = [...dismissedEntries, ...removedWithRows];

  // Global totals — count only jobs that still need work as "active".
  const totals = {
    jobs: needsWork.length,
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
        <Stat label="Jobs needing work" value={totals.jobs} />
        <Stat label="Pending" value={totals.pending} tone="muted" />
        <Stat label="In stock" value={totals.inStock} tone="sky" />
        <Stat label="To order" value={totals.toOrder} tone="amber" />
        <Stat label="Ordered" value={totals.ordered} tone="indigo" />
        <Stat label="Received" value={totals.received} tone="emerald" />
      </div>

      <ProcurementBoard
        ready={readyEntries}
        needsWork={needsWork}
        awaitingDelivery={awaitingDelivery}
        complete={complete}
        dismissed={allDismissed}
      />
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
