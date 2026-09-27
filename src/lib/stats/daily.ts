import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { brisbaneDateISO } from "@/lib/dates";
import { listPaymentsByChargeDate, type GcPayment } from "@/lib/finance/gc";

/**
 * Daily stats snapshot for Mark's Cortex morning briefing
 * (GET /api/stats/daily — see docs/stats-endpoint.md).
 *
 * Rails (Mitchell, 27 Sep 2026):
 *   - READ ONLY. Every query here is a SELECT; GoCardless is GET-only.
 *   - SELL values only. Every select names its columns explicitly — never
 *     `*` — and quote value is pulled as the single JSON path
 *     pricing_snapshot->>totalExGST so the cost/margin keys in the snapshot
 *     never leave the database. No procurement, supplier, finance-agent,
 *     vault or Xero reads.
 *
 * All money is AUD. Job + quote values are ex GST (that's what the quote
 * total and invoice subtotal are); MRR is inc GST (matches the "Effective
 * MRR" tile on /invoices/recurring); GoCardless amounts are what was
 * actually debited.
 */

// ── Status names (statuses.name) this snapshot keys off ──────────────────
const JOB_READY_TO_INVOICE = "Ready to Invoice";
const JOB_COMPLETE = "Complete";
const JOB_CANCELLED = "Cancelled";
const JOB_PENDING_SCHEDULE = "Pending Schedule";
// Same 7-day threshold as the quote-followups cron + Quoting "Follow-up" tab.
const QUOTE_FOLLOWUP_AGE_DAYS = 7;
// GoCardless payment statuses.
const GC_COLLECTED = new Set(["confirmed", "paid_out"]);
const GC_IN_FLIGHT = new Set(["pending_customer_approval", "pending_submission", "submitted"]);
const GC_PROBLEM = new Set(["failed", "charged_back", "cancelled", "customer_approval_denied"]);

const DAY_MS = 86_400_000;
const PAGE = 1000; // PostgREST max-rows cap

// ── helpers ──────────────────────────────────────────────────────────────
const round2 = (n: number) => Math.round(n * 100) / 100;
const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
function one<T>(v: T | T[] | null | undefined): T | null {
  return Array.isArray(v) ? (v[0] ?? null) : (v ?? null);
}

/** Page through a query past the 1,000-row PostgREST cap. */
async function fetchAll<T>(
  build: (from: number, to: number) => PromiseLike<{ data: unknown; error: { message: string } | null }>,
): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as T[];
    out.push(...rows);
    if (rows.length < PAGE) return out;
  }
}

/** Brisbane wall-clock timestamp, e.g. 2026-09-27T07:05:12+10:00 (QLD has no DST). */
export function brisbaneTimestamp(d: Date = new Date()): string {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "Australia/Brisbane",
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
    }).formatToParts(d).map((x) => [x.type, x.value]),
  );
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}+10:00`;
}

/** Calendar maths on YYYY-MM-DD strings (treated as plain dates). */
function addDaysISO(iso: string, days: number): string {
  const t = Date.parse(iso + "T00:00:00Z") + days * DAY_MS;
  // UTC midnight formats to the same date in Brisbane (see lib/dates.ts).
  return brisbaneDateISO(new Date(t));
}
function daysBetweenISO(fromISO: string, toISO: string): number {
  return Math.round((Date.parse(toISO + "T00:00:00Z") - Date.parse(fromISO + "T00:00:00Z")) / DAY_MS);
}
/** Brisbane-midnight instant for a Brisbane date, as an ISO string for timestamptz compares. */
const brisbaneMidnight = (iso: string) => `${iso}T00:00:00+10:00`;

// ── row shapes (explicit columns only) ───────────────────────────────────
interface StatusRow { id: string; name: string; phase: string | null }
interface JobRow {
  id: string;
  number: string | null;
  reference: string | null;
  status_id: string | null;
  due_date: string | null;
  updated_at: string;
  estimated_value: number | string | null;
  site_id: string | null;
  customer_id: string | null;
  customer: { name: string } | { name: string }[] | null;
  site: { name: string } | { name: string }[] | null;
  category: { name: string } | { name: string }[] | null;
}
interface InvoiceLinkRow { job_id: string | null; quote_id: string | null; subtotal: number | string | null }
interface QuoteRow {
  id: string;
  ref: string | null;
  job_id: string | null;
  status: string;
  client_name: string | null;
  site_name: string | null;
  sent_at: string | null;
  accepted_at: string | null;
  expires_at: string | null;
  followup_sent_at: string | null;
  total_ex_gst: string | number | null;
  customer: { name: string } | { name: string }[] | null;
}
interface PlanRow {
  id: string;
  status: string;
  customer_id: string | null;
  site_id: string | null;
  gc_mandate_id: string | null;
  customer: { name: string } | { name: string }[] | null;
  site: { name: string } | { name: string }[] | null;
  items: { price_inc_gst: number | string; frequency: string; quantity: number | null }[] | null;
}
interface PlanSubRow { plan_id: string; gc_subscription_id: string | null }
interface DealRow { stage: string; value: number | string | null; probability: number | string | null }

const JOB_COLS =
  "id, number, reference, status_id, due_date, updated_at, estimated_value, site_id, customer_id, " +
  "customer:customers(name), site:customer_sites(name), category:categories!category_1_id(name)";
const QUOTE_COLS =
  "id, ref, job_id, status, client_name, site_name, sent_at, accepted_at, expires_at, followup_sent_at, " +
  "total_ex_gst:pricing_snapshot->>totalExGST, customer:customers(name)";

const monthlyFactor = (f: string) => (f === "yearly" ? 1 / 12 : f === "quarterly" ? 1 / 3 : 1);

// ── main ─────────────────────────────────────────────────────────────────
export async function buildDailyStats(supabase: SupabaseClient) {
  const now = new Date();
  const today = brisbaneDateISO(now);
  const dow = new Date(today + "T00:00:00Z").getUTCDay(); // 0 = Sunday
  const weekStart = addDaysISO(today, -((dow + 6) % 7)); // Monday
  const monthStart = today.slice(0, 8) + "01";
  const monthEnd = addDaysISO(addDaysISO(monthStart, 32).slice(0, 8) + "01", -1);
  const weekStartTs = brisbaneMidnight(weekStart);
  const followupCutoffMs = now.getTime() - QUOTE_FOLLOWUP_AGE_DAYS * DAY_MS;

  // Statuses first — every job bucket keys off names, never hardcoded ids.
  const { data: statusData, error: statusErr } = await supabase.from("statuses").select("id, name, phase");
  if (statusErr) throw new Error(statusErr.message);
  const statuses = (statusData ?? []) as StatusRow[];
  const statusById = new Map(statuses.map((s) => [s.id, s]));
  const idOf = (name: string) => statuses.find((s) => s.name === name)?.id ?? null;
  const readyId = idOf(JOB_READY_TO_INVOICE);
  const completeId = idOf(JOB_COMPLETE);
  const cancelledId = idOf(JOB_CANCELLED);
  const pendingScheduleId = idOf(JOB_PENDING_SCHEDULE);
  const activeStatusIds = statuses.filter((s) => s.phase !== "completion").map((s) => s.id);
  const jobStatusIds = [...activeStatusIds, readyId, completeId].filter((x): x is string => !!x);

  const [jobs, invoices, quotes, plans, planSubs, dealsRes] = await Promise.all([
    fetchAll<JobRow>((a, b) =>
      supabase.from("jobs").select(JOB_COLS).in("status_id", jobStatusIds).order("id").range(a, b)),
    fetchAll<InvoiceLinkRow>((a, b) =>
      supabase.from("invoices").select("job_id, quote_id, subtotal").neq("status", "void").order("id").range(a, b)),
    fetchAll<QuoteRow>((a, b) =>
      supabase.from("quotes").select(QUOTE_COLS).order("id").range(a, b)),
    fetchAll<PlanRow>((a, b) =>
      supabase
        .from("recurring_plans")
        .select(
          "id, status, customer_id, site_id, gc_mandate_id, customer:customers(name), site:customer_sites(name), " +
            "items:recurring_plan_items(price_inc_gst, frequency, quantity)",
        )
        .order("id")
        .range(a, b)),
    fetchAll<PlanSubRow>((a, b) =>
      supabase.from("recurring_plan_gc_subscriptions").select("plan_id, gc_subscription_id").order("id").range(a, b)),
    supabase.from("pipeline_deals").select("stage, value, probability").in("stage", ["lead", "quote_sent"]),
  ]);
  if (dealsRes.error) throw new Error(dealsRes.error.message);
  const deals = (dealsRes.data ?? []) as DealRow[];

  // ── Quotes ──────────────────────────────────────────────────────────────
  const qValue = (q: QuoteRow) => num(q.total_ex_gst);
  const qCustomer = (q: QuoteRow) => one(q.customer)?.name ?? q.client_name ?? null;
  const isExpired = (q: QuoteRow) =>
    !!q.expires_at && Date.parse(q.expires_at) < now.getTime() && (q.status === "draft" || q.status === "sent");
  const qSummary = (q: QuoteRow) => ({
    ref: q.ref,
    customer: qCustomer(q),
    site: q.site_name,
    value_ex_gst: round2(qValue(q)),
  });
  const sumValue = (qs: QuoteRow[]) => round2(qs.reduce((s, q) => s + qValue(q), 0));

  const activeQuotes = quotes.filter((q) => (q.status === "draft" || q.status === "sent") && !isExpired(q));
  const acceptedThisWeek = quotes.filter(
    (q) => q.status === "accepted" && !!q.accepted_at && Date.parse(q.accepted_at) >= Date.parse(weekStartTs),
  );
  const followUps = quotes.filter(
    (q) => q.status === "sent" && !!q.sent_at && Date.parse(q.sent_at) <= followupCutoffMs && !isExpired(q),
  );
  // Past expiry but never accepted/declined — dead weight, reported apart
  // from the follow-up list so it doesn't swamp it.
  const expiredUnresolved = quotes.filter(isExpired);
  const expiredThisWeek = quotes.filter(
    (q) => isExpired(q) && Date.parse(q.expires_at as string) >= Date.parse(weekStartTs),
  );

  // ── Jobs awaiting invoicing ─────────────────────────────────────────────
  const invoicedByJob = new Map<string, number>();
  const invoicedByQuote = new Map<string, number>();
  for (const inv of invoices) {
    if (inv.job_id) invoicedByJob.set(inv.job_id, (invoicedByJob.get(inv.job_id) ?? 0) + num(inv.subtotal));
    if (inv.quote_id) invoicedByQuote.set(inv.quote_id, (invoicedByQuote.get(inv.quote_id) ?? 0) + num(inv.subtotal));
  }
  const quotesByJob = new Map<string, QuoteRow[]>();
  for (const q of quotes) {
    if (!q.job_id) continue;
    const list = quotesByJob.get(q.job_id) ?? [];
    list.push(q);
    quotesByJob.set(q.job_id, list);
  }
  const hasAnyInvoice = (j: JobRow) =>
    invoicedByJob.has(j.id) || (quotesByJob.get(j.id) ?? []).some((q) => invoicedByQuote.has(q.id));

  // Sites/customers carrying an active recurring plan — a completed IT/NBN
  // job there may be covered by the plan rather than needing its own invoice.
  const activePlans = plans.filter((p) => p.status === "active");
  const recurringSites = new Set(activePlans.map((p) => p.site_id).filter(Boolean) as string[]);

  /**
   * Remaining sell value to invoice: accepted quote total(s) on the job less
   * everything already invoiced (non-void) against the job or those quotes.
   * Falls back to jobs.estimated_value; null when neither exists.
   */
  function awaitingValue(j: JobRow): { value: number | null; source: string | null } {
    const accepted = (quotesByJob.get(j.id) ?? []).filter((q) => q.status === "accepted");
    if (accepted.length > 0) {
      const quoted = accepted.reduce((s, q) => s + qValue(q), 0);
      const invoiced = Math.max(
        invoicedByJob.get(j.id) ?? 0,
        accepted.reduce((s, q) => s + (invoicedByQuote.get(q.id) ?? 0), 0),
      );
      return { value: round2(Math.max(0, quoted - invoiced)), source: "accepted_quote_less_invoiced" };
    }
    const est = num(j.estimated_value);
    if (est > 0) return { value: round2(est), source: "job_estimated_value" };
    return { value: null, source: null };
  }

  const awaiting = jobs
    .filter((j) => j.status_id === readyId || (j.status_id === completeId && !hasAnyInvoice(j)))
    .map((j) => {
      const v = awaitingValue(j);
      const lastUpdate = brisbaneDateISO(new Date(j.updated_at));
      return {
        number: j.number,
        reference: j.reference,
        customer: one(j.customer)?.name ?? null,
        site: one(j.site)?.name ?? null,
        category: one(j.category)?.name ?? null,
        reason: j.status_id === readyId ? "ready_to_invoice" : "complete_no_invoice",
        last_updated: lastUpdate,
        days_waiting: Math.max(0, daysBetweenISO(lastUpdate, today)),
        value_ex_gst: v.value,
        value_source: v.source,
        site_has_active_recurring_plan: !!j.site_id && recurringSites.has(j.site_id),
      };
    })
    .sort((a, b) => b.days_waiting - a.days_waiting);

  const byCustomer = new Map<string, { customer: string; count: number; value_ex_gst: number; jobs: typeof awaiting }>();
  for (const a of awaiting) {
    const key = a.customer ?? "(no customer)";
    const g = byCustomer.get(key) ?? { customer: key, count: 0, value_ex_gst: 0, jobs: [] };
    g.count += 1;
    g.value_ex_gst = round2(g.value_ex_gst + (a.value_ex_gst ?? 0));
    g.jobs.push(a);
    byCustomer.set(key, g);
  }
  const oldest = awaiting[0] ?? null;

  // ── Open jobs ───────────────────────────────────────────────────────────
  const openJobs = jobs.filter((j) => j.status_id && activeStatusIds.includes(j.status_id) && j.status_id !== cancelledId);
  const statusName = (j: JobRow) => (j.status_id ? statusById.get(j.status_id)?.name : null) ?? "Unknown";
  const jobBrief = (j: JobRow) => ({
    number: j.number,
    customer: one(j.customer)?.name ?? null,
    site: one(j.site)?.name ?? null,
    status: statusName(j),
  });
  const openByStatus: Record<string, number> = {};
  for (const j of openJobs) openByStatus[statusName(j)] = (openByStatus[statusName(j)] ?? 0) + 1;
  const inProgress = openJobs.filter((j) => statusById.get(j.status_id as string)?.phase === "in_progress");
  const inProgressByStatus: Record<string, number> = {};
  for (const j of inProgress) inProgressByStatus[statusName(j)] = (inProgressByStatus[statusName(j)] ?? 0) + 1;
  const overdue = openJobs
    .filter((j) => !!j.due_date && j.due_date < today)
    .map((j) => ({ ...jobBrief(j), due_date: j.due_date, days_overdue: daysBetweenISO(j.due_date as string, today) }))
    .sort((a, b) => b.days_overdue - a.days_overdue);
  const waitingToSchedule = openJobs
    .filter((j) => j.status_id === pendingScheduleId)
    .map((j) => {
      const since = brisbaneDateISO(new Date(j.updated_at));
      return { ...jobBrief(j), days_waiting: Math.max(0, daysBetweenISO(since, today)) };
    })
    .sort((a, b) => b.days_waiting - a.days_waiting);

  // ── Recurring ───────────────────────────────────────────────────────────
  const planMonthly = (p: PlanRow) =>
    (p.items ?? []).reduce((s, i) => s + num(i.price_inc_gst) * (i.quantity ?? 1) * monthlyFactor(i.frequency), 0);
  const pendingPlans = plans.filter((p) => p.status === "pending_mandate");
  const planStatusCounts: Record<string, number> = {};
  for (const p of plans) planStatusCounts[p.status] = (planStatusCounts[p.status] ?? 0) + 1;

  const gocardless = await gcMonth(monthStart, monthEnd, plans, planSubs);

  // ── Pipeline ────────────────────────────────────────────────────────────
  const leadDeals = deals.filter((d) => d.stage === "lead");
  const openDeals = deals;
  const openQuotesValue = sumValue(activeQuotes);
  const leadDealsValue = round2(leadDeals.reduce((s, d) => s + num(d.value), 0));

  return {
    generated_at: brisbaneTimestamp(now),
    date: today,
    timezone: "Australia/Brisbane",
    periods: { week_start: weekStart, month_start: monthStart, month_end: monthEnd },
    currency: "AUD",

    awaiting_invoicing: {
      count: awaiting.length,
      value_ex_gst: round2(awaiting.reduce((s, a) => s + (a.value_ex_gst ?? 0), 0)),
      count_without_value: awaiting.filter((a) => a.value_ex_gst === null).length,
      ready_to_invoice_count: awaiting.filter((a) => a.reason === "ready_to_invoice").length,
      complete_no_invoice_count: awaiting.filter((a) => a.reason === "complete_no_invoice").length,
      oldest: oldest
        ? { number: oldest.number, customer: oldest.customer, days_waiting: oldest.days_waiting, reason: oldest.reason }
        : null,
      by_customer: [...byCustomer.values()].sort((a, b) => b.count - a.count || b.value_ex_gst - a.value_ex_gst),
    },

    jobs: {
      open_count: openJobs.length,
      open_by_status: openByStatus,
      in_progress: { count: inProgress.length, by_status: inProgressByStatus },
      overdue: { count: overdue.length, jobs: overdue },
      waiting_to_schedule: { count: waitingToSchedule.length, jobs: waitingToSchedule },
    },

    quotes: {
      active: {
        count: activeQuotes.length,
        value_ex_gst: openQuotesValue,
        draft: activeQuotes.filter((q) => q.status === "draft").length,
        sent: activeQuotes.filter((q) => q.status === "sent").length,
      },
      accepted_this_week: {
        count: acceptedThisWeek.length,
        value_ex_gst: sumValue(acceptedThisWeek),
        quotes: acceptedThisWeek.map((q) => ({ ...qSummary(q), accepted_on: brisbaneDateISO(new Date(q.accepted_at as string)) })),
      },
      follow_ups_due: {
        count: followUps.length,
        value_ex_gst: sumValue(followUps),
        quotes: followUps
          .map((q) => ({
            ...qSummary(q),
            days_since_sent: Math.floor((now.getTime() - Date.parse(q.sent_at as string)) / DAY_MS),
            auto_followup_sent: !!q.followup_sent_at,
          }))
          .sort((a, b) => b.days_since_sent - a.days_since_sent),
      },
      expired_unresolved: { count: expiredUnresolved.length, value_ex_gst: sumValue(expiredUnresolved) },
      expired_this_week: {
        count: expiredThisWeek.length,
        value_ex_gst: sumValue(expiredThisWeek),
        quotes: expiredThisWeek.map((q) => ({ ...qSummary(q), expired_on: brisbaneDateISO(new Date(q.expires_at as string)) })),
      },
    },

    recurring: {
      mrr_inc_gst: round2(activePlans.reduce((s, p) => s + planMonthly(p), 0)),
      active_plans: activePlans.length,
      pending_mandate: { count: pendingPlans.length, mrr_inc_gst: round2(pendingPlans.reduce((s, p) => s + planMonthly(p), 0)) },
      plans_by_status: planStatusCounts,
      gocardless,
    },

    pipeline: {
      total_value_ex_gst: round2(openQuotesValue + leadDealsValue),
      open_quotes: { count: activeQuotes.length, value_ex_gst: openQuotesValue },
      deals: {
        count: openDeals.length,
        value: round2(openDeals.reduce((s, d) => s + num(d.value), 0)),
        weighted_value: round2(openDeals.reduce((s, d) => s + num(d.value) * (num(d.probability) / 100), 0)),
        lead_stage_value: leadDealsValue,
      },
    },
  };
}

/** GoCardless payments charged this Brisbane calendar month (GET only). */
async function gcMonth(monthStart: string, monthEnd: string, plans: PlanRow[], subs: PlanSubRow[]) {
  let payments: GcPayment[];
  try {
    payments = await listPaymentsByChargeDate(monthStart, monthEnd);
  } catch (e) {
    return { error: e instanceof Error ? e.message.slice(0, 200) : "GoCardless unavailable" };
  }
  const planById = new Map(plans.map((p) => [p.id, p]));
  const planByMandate = new Map(plans.filter((p) => p.gc_mandate_id).map((p) => [p.gc_mandate_id as string, p]));
  const planBySub = new Map(
    subs.filter((s) => s.gc_subscription_id).map((s) => [s.gc_subscription_id as string, planById.get(s.plan_id)]),
  );
  const who = (p: GcPayment) => {
    const plan = (p.links?.subscription && planBySub.get(p.links.subscription)) ||
      (p.links?.mandate && planByMandate.get(p.links.mandate)) || null;
    return { customer: plan ? (one(plan.customer)?.name ?? null) : null, site: plan ? (one(plan.site)?.name ?? null) : null };
  };
  const aud = (ps: GcPayment[]) => round2(ps.reduce((s, p) => s + p.amount, 0) / 100);
  const collected = payments.filter((p) => GC_COLLECTED.has(p.status));
  const inFlight = payments.filter((p) => GC_IN_FLIGHT.has(p.status));
  const problems = payments.filter((p) => GC_PROBLEM.has(p.status));
  return {
    collected: { count: collected.length, amount: aud(collected) },
    pending: { count: inFlight.length, amount: aud(inFlight) },
    failed_or_cancelled: {
      count: problems.length,
      amount: aud(problems),
      payments: problems
        .map((p) => ({ ...who(p), status: p.status, charge_date: p.charge_date, amount: round2(p.amount / 100) }))
        .sort((a, b) => a.charge_date.localeCompare(b.charge_date)),
    },
  };
}
