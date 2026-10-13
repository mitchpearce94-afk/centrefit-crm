import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { brisbaneDateISO } from "@/lib/dates";

/**
 * Work status report (Mark, 14 Oct 2026): "if we don't complete our jobs
 * they can't be invoiced, and if they're not invoiced we don't get paid."
 *
 * Four questions, every weekday at 4pm, grouped by staff member:
 *   1. Visits that have finished with nothing written in Work Completed
 *      (plus: jobs being worked with no diary entry; jobs written up but
 *      never sent to invoice).
 *   2. Jobs sent to invoice with no write-up (legacy — the DB gate now
 *      stops new ones).
 *   3. Jobs sent to invoice but not yet invoiced (the money queue).
 *   4. Jobs with no status at all.
 *
 * Rules that keep it fair as a KPI (Mark, 06:15 same day: "it has to be exact"):
 *   - a visit counts only once its end has passed (future-dated ignored);
 *   - did_not_attend / rescheduled visits never count;
 *   - external/subcontractor staff are never scored — their work lands on
 *     the staff assigned to the job, else the job creator;
 *   - a job stays on the list until it is cleared; "day N" is remembered
 *     in work_status_report_items.
 */

export const WORKED_STATUSES = new Set(["Scheduled", "In Progress", "Rough In", "Fit Off", "Equipment Build"]);
const READY = "Ready to Invoice";
const COMPLETE = "Complete";
const DAY_MS = 86_400_000;
const BRISBANE_OFFSET = "+10:00";

export type Section = "not_written_up" | "no_diary" | "not_sent_to_invoice" | "sent_no_writeup" | "awaiting_invoicing" | "no_status";

export interface ReportItem {
  section: Section;
  job_id: string;
  number: string;
  reference: string | null;
  customer: string | null;
  site: string | null;
  status: string | null;
  url: string;
  /** Staff ids this item is attributed to (every attendee of the visit, or the job owner). */
  staff_ids: string[];
  detail: string;        // "visit Tue 13 Oct 8:00–11:00" / "last visit 9 Oct" / "waiting 134 days"
  days: number;          // age of the thing that's wrong (days since visit / since ready / since created)
  value_ex_gst: number | null;
  day_on_list: number;   // 1 = first time it's reported
}

export interface StaffBucket {
  staff_id: string | null;
  name: string;
  email: string | null;
  items: ReportItem[];
}

export interface WorkStatusReport {
  date: string;              // YYYY-MM-DD Brisbane
  generated_at: string;
  checked: { visits: number; worked_jobs: number; sent_to_invoice: number; jobs: number };
  counts: Record<Section, number>;
  items: ReportItem[];
  by_staff: StaffBucket[];
  cleared_since_last: { number: string; section: Section; reference: string | null }[];
  staff: { id: string; name: string; email: string | null; is_external: boolean; role: string }[];
}

type Rel<T> = T | T[] | null | undefined;
const one = <T,>(v: Rel<T>): T | null => (Array.isArray(v) ? v[0] ?? null : v ?? null);

interface JobRow {
  id: string; number: string; reference: string | null; status_id: string | null; created_by: string | null;
  created_at: string; updated_at: string; estimated_value: number | string | null; no_charge_reason: string | null;
  customer: Rel<{ name: string }>; site: Rel<{ name: string }>;
}
interface VisitRow { id: string; job_id: string; staff_id: string | null; schedule_date: string; end_date: string | null; start_time: string | null; end_time: string | null; attendance: string | null }
interface WorkRow { job_id: string; staff_id: string | null; work_date: string; content: string | null }

async function fetchAll<T>(page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await page(from, from + 999);
    if (error) throw new Error(error.message);
    out.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  return out;
}

function fmtDate(iso: string): string {
  return new Date(iso + "T00:00:00+10:00").toLocaleDateString("en-AU", { timeZone: "Australia/Brisbane", weekday: "short", day: "numeric", month: "short" });
}
function fmtTime(t: string | null): string {
  if (!t) return "";
  const [h, m] = t.split(":").map(Number);
  const ap = h >= 12 ? "pm" : "am";
  const hh = h % 12 === 0 ? 12 : h % 12;
  return m ? `${hh}:${String(m).padStart(2, "0")}${ap}` : `${hh}${ap}`;
}
function daysBetween(aISO: string, bISO: string): number {
  return Math.round((Date.parse(bISO + "T00:00:00Z") - Date.parse(aISO + "T00:00:00Z")) / DAY_MS);
}

/** When did the visit finish? Null if it hasn't yet. */
function visitEndMs(v: VisitRow): number {
  const day = v.end_date ?? v.schedule_date;
  const time = v.end_time ?? (v.start_time ? null : null);
  // No end time: the visit is over once the day is over (Brisbane midnight).
  return time
    ? Date.parse(`${day}T${time.length === 5 ? time + ":00" : time}${BRISBANE_OFFSET}`)
    : Date.parse(`${day}T23:59:59${BRISBANE_OFFSET}`);
}

export async function buildWorkStatusReport(db: SupabaseClient, opts?: { now?: Date; persist?: boolean; appBaseUrl?: string }): Promise<WorkStatusReport> {
  const now = opts?.now ?? new Date();
  const today = brisbaneDateISO(now);
  const base = (opts?.appBaseUrl ?? "https://crm.centrefit.com.au").replace(/\/$/, "");

  const [{ data: statusRows }, { data: staffRows }] = await Promise.all([
    db.from("statuses").select("id, name, phase"),
    db.from("staff").select("id, display_name, email, is_active, is_external, role"),
  ]);
  const statusName = new Map((statusRows ?? []).map((s) => [s.id as string, s.name as string]));
  const idOf = (name: string) => (statusRows ?? []).find((s) => s.name === name)?.id as string | undefined;
  const readyId = idOf(READY), completeId = idOf(COMPLETE);
  const workedIds = (statusRows ?? []).filter((s) => WORKED_STATUSES.has(s.name)).map((s) => s.id as string);
  const staff = (staffRows ?? []).map((s) => ({ id: s.id as string, name: s.display_name as string, email: (s.email as string | null) ?? null, is_external: !!s.is_external, role: s.role as string, is_active: !!s.is_active }));
  const staffById = new Map(staff.map((s) => [s.id, s]));
  const isScorable = (id: string | null | undefined) => !!id && staffById.has(id) && !staffById.get(id)!.is_external && staffById.get(id)!.is_active;

  const jobSel = "id, number, reference, status_id, created_by, created_at, updated_at, estimated_value, no_charge_reason, customer:customers(name), site:customer_sites(name)";
  const interestingIds = [...workedIds, readyId, completeId].filter((x): x is string => !!x);
  const [jobs, noStatusJobs] = await Promise.all([
    fetchAll<JobRow>((a, b) => db.from("jobs").select(jobSel).in("status_id", interestingIds).order("id").range(a, b)),
    fetchAll<JobRow>((a, b) => db.from("jobs").select(jobSel).is("status_id", null).order("id").range(a, b)),
  ]);
  const jobIds = jobs.map((j) => j.id);
  const chunk = <T,>(arr: T[], n = 400): T[][] => Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, i * n + n));

  const visits: VisitRow[] = [], work: WorkRow[] = [], jobStaff: { job_id: string; staff_id: string }[] = [];
  const invoiced = new Set<string>();
  const quoteByJob = new Map<string, { id: string; status: string; total: number }[]>();
  const invoicedQuoteSubtotal = new Map<string, number>();
  const invoicedJobSubtotal = new Map<string, number>();
  for (const ids of chunk(jobIds)) {
    const [v, w, js, inv, q] = await Promise.all([
      db.from("schedule_entries").select("id, job_id, staff_id, schedule_date, end_date, start_time, end_time, attendance").eq("entry_type", "job").in("job_id", ids),
      db.from("job_work_entries").select("job_id, staff_id, work_date, content").in("job_id", ids),
      db.from("job_staff").select("job_id, staff_id").in("job_id", ids),
      db.from("invoices").select("job_id, quote_id, subtotal").neq("status", "void").in("job_id", ids),
      db.from("quotes").select("id, job_id, status, total:pricing_snapshot->>totalExGST").in("job_id", ids),
    ]);
    visits.push(...((v.data ?? []) as VisitRow[]));
    work.push(...((w.data ?? []) as WorkRow[]));
    jobStaff.push(...((js.data ?? []) as { job_id: string; staff_id: string }[]));
    for (const i of inv.data ?? []) {
      if (i.job_id) { invoiced.add(i.job_id); invoicedJobSubtotal.set(i.job_id, (invoicedJobSubtotal.get(i.job_id) ?? 0) + Number(i.subtotal ?? 0)); }
      if (i.quote_id) invoicedQuoteSubtotal.set(i.quote_id, (invoicedQuoteSubtotal.get(i.quote_id) ?? 0) + Number(i.subtotal ?? 0));
    }
    for (const qq of q.data ?? []) {
      if (!qq.job_id) continue;
      const list = quoteByJob.get(qq.job_id) ?? [];
      list.push({ id: qq.id, status: qq.status, total: Number(qq.total ?? 0) });
      quoteByJob.set(qq.job_id, list);
    }
  }
  // Quote-linked invoices that aren't job-linked still count as "invoiced".
  const quoteIds = [...quoteByJob.values()].flat().map((q) => q.id);
  for (const ids of chunk(quoteIds)) {
    const { data } = await db.from("invoices").select("quote_id, subtotal").neq("status", "void").in("quote_id", ids);
    for (const i of data ?? []) if (i.quote_id) invoicedQuoteSubtotal.set(i.quote_id, (invoicedQuoteSubtotal.get(i.quote_id) ?? 0) + Number(i.subtotal ?? 0));
  }
  const hasInvoice = (j: JobRow) => invoiced.has(j.id) || (quoteByJob.get(j.id) ?? []).some((q) => invoicedQuoteSubtotal.has(q.id));

  const visitsByJob = new Map<string, VisitRow[]>();
  for (const v of visits) { const l = visitsByJob.get(v.job_id) ?? []; l.push(v); visitsByJob.set(v.job_id, l); }
  const workByJob = new Map<string, WorkRow[]>();
  for (const w of work) { if (!(w.content ?? "").trim()) continue; const l = workByJob.get(w.job_id) ?? []; l.push(w); workByJob.set(w.job_id, l); }
  const staffByJob = new Map<string, string[]>();
  for (const s of jobStaff) { const l = staffByJob.get(s.job_id) ?? []; l.push(s.staff_id); staffByJob.set(s.job_id, l); }

  /** Who carries an item: the scorable attendees, else the job's scorable assignees, else the creator. */
  const owners = (job: JobRow, attendees: (string | null)[] = []): string[] => {
    const a = [...new Set(attendees.filter(isScorable) as string[])];
    if (a.length) return a;
    const assigned = [...new Set((staffByJob.get(job.id) ?? []).filter(isScorable))];
    if (assigned.length) return assigned;
    return isScorable(job.created_by) ? [job.created_by as string] : [];
  };
  const jobBits = (j: JobRow) => ({
    job_id: j.id, number: j.number, reference: j.reference,
    customer: one(j.customer)?.name ?? null, site: one(j.site)?.name ?? null,
    status: j.status_id ? statusName.get(j.status_id) ?? null : null, url: `${base}/jobs/${j.id}`,
  });
  const valueOf = (j: JobRow): number | null => {
    const accepted = (quoteByJob.get(j.id) ?? []).filter((q) => q.status === "accepted");
    if (accepted.length) {
      const quoted = accepted.reduce((s, q) => s + q.total, 0);
      const inv = Math.max(invoicedJobSubtotal.get(j.id) ?? 0, accepted.reduce((s, q) => s + (invoicedQuoteSubtotal.get(q.id) ?? 0), 0));
      return Math.round(Math.max(0, quoted - inv) * 100) / 100;
    }
    const est = Number(j.estimated_value ?? 0);
    return est > 0 ? Math.round(est * 100) / 100 : null;
  };

  const items: ReportItem[] = [];
  const nowMs = now.getTime();
  let visitsChecked = 0, workedJobs = 0, sentToInvoice = 0;

  for (const j of jobs) {
    const st = j.status_id ? statusName.get(j.status_id) : null;
    const jv = visitsByJob.get(j.id) ?? [];
    const jw = workByJob.get(j.id) ?? [];
    const lastWork = jw.map((w) => w.work_date).sort().pop() ?? null;

    if (st && WORKED_STATUSES.has(st)) {
      workedJobs++;
      const finished = jv.filter((v) => !v.attendance && visitEndMs(v) <= nowMs);
      visitsChecked += finished.length;
      const future = jv.some((v) => !v.attendance && visitEndMs(v) > nowMs);
      // 1 — finished visits with no write-up on/after the visit day. One line
      //     per job (the latest unwritten visit), attributed to every attendee.
      const unwritten = finished.filter((v) => !jw.some((w) => w.work_date >= v.schedule_date));
      if (unwritten.length) {
        const latest = unwritten.sort((a, b) => (a.schedule_date < b.schedule_date ? 1 : -1))[0];
        const sameDay = unwritten.filter((v) => v.schedule_date === latest.schedule_date);
        const when = `${fmtDate(latest.schedule_date)}${latest.start_time ? ` ${fmtTime(latest.start_time)}` : ""}${latest.end_time ? `–${fmtTime(latest.end_time)}` : ""}`;
        items.push({ ...jobBits(j), section: "not_written_up", staff_ids: owners(j, sameDay.map((v) => v.staff_id)),
          detail: `visit ${when}${unwritten.length > 1 ? ` (+${unwritten.length - 1} more)` : ""} — nothing in Work Completed`,
          days: daysBetween(latest.schedule_date, today), value_ex_gst: null, day_on_list: 1 });
        continue;
      }
      // 1b — being worked, nothing in the diary at all.
      if (jv.length === 0) {
        items.push({ ...jobBits(j), section: "no_diary", staff_ids: owners(j), detail: `${st} since ${fmtDate(brisbaneDateISO(new Date(j.updated_at)))}, no diary entry`,
          days: daysBetween(brisbaneDateISO(new Date(j.updated_at)), today), value_ex_gst: null, day_on_list: 1 });
        continue;
      }
      // 1c — written up, last visit 2+ days ago, nothing booked, never sent to invoice.
      if (lastWork && !future && finished.length) {
        const lastVisit = finished.map((v) => v.end_date ?? v.schedule_date).sort().pop() as string;
        const age = daysBetween(lastVisit, today);
        if (age >= 2) {
          items.push({ ...jobBits(j), section: "not_sent_to_invoice", staff_ids: owners(j, finished.filter((v) => (v.end_date ?? v.schedule_date) === lastVisit).map((v) => v.staff_id)),
            detail: `written up, last visit ${fmtDate(lastVisit)}, still ${st} — send to invoice or book the next visit`, days: age, value_ex_gst: null, day_on_list: 1 });
        }
      }
      continue;
    }

    if (j.status_id === readyId || (j.status_id === completeId && !hasInvoice(j))) {
      sentToInvoice++;
      const readyDate = brisbaneDateISO(new Date(j.updated_at));
      const days = daysBetween(readyDate, today);
      if (jw.length === 0) {
        items.push({ ...jobBits(j), section: "sent_no_writeup", staff_ids: owners(j, jv.map((v) => v.staff_id)),
          detail: `${st} with nothing in Work Completed`, days, value_ex_gst: valueOf(j), day_on_list: 1 });
      }
      items.push({ ...jobBits(j), section: "awaiting_invoicing", staff_ids: owners(j),
        detail: `${st === READY ? "ready to invoice" : "complete, no invoice"} for ${days} day${days === 1 ? "" : "s"}`, days, value_ex_gst: valueOf(j), day_on_list: 1 });
    }
  }
  for (const j of noStatusJobs) {
    items.push({ ...jobBits(j), section: "no_status", staff_ids: owners(j), detail: `created ${fmtDate(brisbaneDateISO(new Date(j.created_at)))}, no status`,
      days: daysBetween(brisbaneDateISO(new Date(j.created_at)), today), value_ex_gst: null, day_on_list: 1 });
  }

  // Day-N memory + "cleared since last report".
  const { data: prev } = await db.from("work_status_report_items").select("job_id, section, first_seen, last_seen, cleared_on");
  const prevMap = new Map((prev ?? []).map((r) => [`${r.job_id}|${r.section}`, r]));
  const seenNow = new Set<string>();
  for (const it of items) {
    const key = `${it.job_id}|${it.section}`;
    seenNow.add(key);
    const p = prevMap.get(key);
    if (p && !p.cleared_on) it.day_on_list = daysBetween(p.first_seen as string, today) + 1;
  }
  const lastRun = (prev ?? []).reduce<string | null>((m, r) => (!r.cleared_on && (!m || r.last_seen > m) ? (r.last_seen as string) : m), null);
  const clearedNow = (prev ?? []).filter((r) => !r.cleared_on && r.last_seen === lastRun && !seenNow.has(`${r.job_id}|${r.section}`));
  const clearedNumbers = new Map<string, { number: string; reference: string | null }>();
  if (clearedNow.length) {
    const { data } = await db.from("jobs").select("id, number, reference").in("id", clearedNow.map((r) => r.job_id));
    for (const j of data ?? []) clearedNumbers.set(j.id, { number: j.number, reference: j.reference });
  }
  const cleared_since_last = clearedNow.map((r) => ({ number: clearedNumbers.get(r.job_id)?.number ?? r.job_id.slice(0, 8), reference: clearedNumbers.get(r.job_id)?.reference ?? null, section: r.section as Section }));

  if (opts?.persist !== false) {
    const upserts = items.map((it) => {
      const p = prevMap.get(`${it.job_id}|${it.section}`);
      const carry = p && !p.cleared_on;
      return { job_id: it.job_id, section: it.section, first_seen: carry ? p!.first_seen : today, last_seen: today, cleared_on: null };
    });
    for (const rows of chunk(upserts, 500)) {
      const { error } = await db.from("work_status_report_items").upsert(rows, { onConflict: "job_id,section" });
      if (error) console.error("[work-status] upsert", error.message);
    }
    if (clearedNow.length) {
      for (const r of clearedNow) {
        await db.from("work_status_report_items").update({ cleared_on: today }).eq("job_id", r.job_id).eq("section", r.section);
      }
    }
  }

  // Group by staff — an item with several attendees appears under each.
  const buckets = new Map<string, StaffBucket>();
  for (const it of items) {
    const targets = it.staff_ids.length ? it.staff_ids : ["__unassigned"];
    for (const sid of targets) {
      const s = staffById.get(sid);
      const b = buckets.get(sid) ?? { staff_id: s ? sid : null, name: s?.name ?? "Unassigned", email: s?.email ?? null, items: [] };
      b.items.push(it);
      buckets.set(sid, b);
    }
  }
  const sectionOrder: Section[] = ["not_written_up", "no_diary", "not_sent_to_invoice", "sent_no_writeup", "awaiting_invoicing", "no_status"];
  const by_staff = [...buckets.values()]
    .map((b) => ({ ...b, items: b.items.sort((a, c) => sectionOrder.indexOf(a.section) - sectionOrder.indexOf(c.section) || c.days - a.days) }))
    .sort((a, b) => b.items.length - a.items.length || a.name.localeCompare(b.name));

  const counts = Object.fromEntries(sectionOrder.map((s) => [s, items.filter((i) => i.section === s).length])) as Record<Section, number>;
  return {
    date: today, generated_at: now.toISOString(),
    checked: { visits: visitsChecked, worked_jobs: workedJobs, sent_to_invoice: sentToInvoice, jobs: jobs.length + noStatusJobs.length },
    counts, items, by_staff, cleared_since_last,
    staff: staff.filter((s) => s.is_active).map(({ id, name, email, is_external, role }) => ({ id, name, email, is_external, role })),
  };
}
