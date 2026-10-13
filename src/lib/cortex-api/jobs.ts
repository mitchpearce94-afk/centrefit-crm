import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Shared shaping + name resolution for Mark's Cortex CRM API (docs/cortex-api.md).
 * Sell-side fields only: no cost, margin, supplier, procurement or finance reads.
 */

export const JOB_SELECT =
  "id, number, reference, description, due_date, priority, created_at, updated_at, no_charge_reason, " +
  "status:statuses(name), customer:customers(id, name), site:customer_sites(id, name, address, suburb, state, postcode), " +
  "category_1:categories!category_1_id(name), category_2:categories!category_2_id(name), " +
  "staff:job_staff(staff:staff(id, display_name, email, is_external)), " +
  "schedule:schedule_entries(id, schedule_date, end_date, start_time, end_time, notes, attendance, staff:staff!schedule_entries_staff_id_fkey(display_name)), " +
  // Work Completed log + time entries (Mark, 14 Oct 2026: the work-status KPI
  // can't score anyone without them). Sell-side only: no cost columns exist here.
  "work:job_work_entries(id, work_date, content, labour_hours, materials, call_out, image_urls, created_at, staff:staff(display_name)), " +
  "time:job_time(id, start_time, end_time, billable, staff:staff(display_name))";

type Rel<T> = T | T[] | null | undefined;
export const one = <T,>(v: Rel<T>): T | null => (Array.isArray(v) ? v[0] ?? null : v ?? null);
const many = <T,>(v: Rel<T>): T[] => (Array.isArray(v) ? v : v ? [v] : []);

export interface JobRow {
  id: string; number: string; reference: string | null; description: string | null; due_date: string | null; priority: number | null;
  created_at: string; updated_at: string; no_charge_reason?: string | null;
  status: Rel<{ name: string }>; customer: Rel<{ id: string; name: string }>;
  site: Rel<{ id: string; name: string; address: string | null; suburb: string | null; state: string | null; postcode: string | null }>;
  category_1: Rel<{ name: string }>; category_2: Rel<{ name: string }>;
  staff: Rel<{ staff: Rel<{ id: string; display_name: string; email: string | null; is_external?: boolean | null }> }>;
  schedule: Rel<{ id: string; schedule_date: string; end_date: string | null; start_time: string | null; end_time: string | null; notes: string | null; attendance?: string | null; staff: Rel<{ display_name: string }> }>;
  work?: Rel<{ id: string; work_date: string; content: string | null; labour_hours: number | null; materials: unknown; call_out: boolean | null; image_urls: unknown; created_at: string; staff: Rel<{ display_name: string }> }>;
  time?: Rel<{ id: string; start_time: string; end_time: string | null; billable: boolean | null; staff: Rel<{ display_name: string }> }>;
}

export function shapeJob(j: JobRow) {
  const site = one(j.site);
  const address = site ? [site.address, site.suburb, site.state, site.postcode].filter(Boolean).join(" ") : null;
  const schedule = many(j.schedule)
    .map((s) => ({ id: s.id, date: s.schedule_date, end_date: s.end_date, start: s.start_time?.slice(0, 5) ?? null, end: s.end_time?.slice(0, 5) ?? null, staff: one(s.staff)?.display_name ?? null, notes: s.notes, attendance: s.attendance ?? "attended" }))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const work = many(j.work)
    .filter((w) => (w.content ?? "").trim().length > 0 || (Array.isArray(w.image_urls) && w.image_urls.length > 0))
    .map((w) => ({
      id: w.id, date: w.work_date, by: one(w.staff)?.display_name ?? null, content: w.content ?? "",
      labour_hours: w.labour_hours != null ? Number(w.labour_hours) : null,
      materials_count: Array.isArray(w.materials) ? w.materials.length : 0,
      photo_count: Array.isArray(w.image_urls) ? w.image_urls.length : 0,
      call_out: !!w.call_out, created_at: w.created_at,
    }))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const time = many(j.time)
    .map((t) => ({ id: t.id, by: one(t.staff)?.display_name ?? null, start: t.start_time, end: t.end_time, billable: t.billable ?? null,
      hours: t.end_time ? Math.round(((Date.parse(t.end_time) - Date.parse(t.start_time)) / 36e5) * 100) / 100 : null }))
    .sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0));
  const staffRows = many(j.staff).map((s) => one(s.staff)).filter((s): s is NonNullable<typeof s> => !!s);
  return {
    number: j.number,
    reference: j.reference,
    description: j.description,
    status: one(j.status)?.name ?? null,
    customer: one(j.customer)?.name ?? null,
    site: site?.name ?? null,
    site_address: address,
    category: one(j.category_1)?.name ?? null,
    business_unit: one(j.category_2)?.name ?? null,
    staff: staffRows.map((s) => s.display_name),
    staff_detail: staffRows.map((s) => ({ name: s.display_name, email: s.email, external: !!s.is_external })),
    schedule,
    // Work Completed — the write-up log. `work_completed` is the joined text
    // (empty string when nothing has been written), `work_entries` the rows.
    work_completed: work.map((w) => w.content).filter(Boolean).join("\n\n"),
    work_entries: work,
    work_entry_count: work.length,
    last_work_date: work.length ? work[work.length - 1].date : null,
    photo_count: work.reduce((n, w) => n + w.photo_count, 0),
    materials_count: work.reduce((n, w) => n + w.materials_count, 0),
    labour_hours: Math.round(work.reduce((n, w) => n + (w.labour_hours ?? 0), 0) * 100) / 100,
    time_entries: time,
    no_charge_reason: j.no_charge_reason ?? null,
    next_scheduled: schedule.find((s) => s.date >= new Date().toISOString().slice(0, 10)) ?? null,
    due_date: j.due_date,
    priority: j.priority,
    created_at: j.created_at,
    updated_at: j.updated_at,
    url: `https://crm.centrefit.com.au/jobs/${j.id}`,
  };
}

export type ShapedJob = ReturnType<typeof shapeJob>;

/** "CFA05256", "cfa5256", "5256" → "CFA05256". */
export function normaliseJobNumber(raw: string): string | null {
  const m = /^\s*(?:cfa)?\s*0*(\d{1,6})\s*$/i.exec(raw);
  return m ? `CFA${m[1].padStart(5, "0")}` : null;
}

/** "8", "8am", "08:00", "8:30", "2pm", "14:00" → "HH:MM:SS" (or null). */
export function normaliseTime(raw: unknown): string | null {
  if (typeof raw !== "string" && typeof raw !== "number") return null;
  const s = String(raw).trim().toLowerCase();
  const m = /^(\d{1,2})(?::(\d{2}))?(?::\d{2})?\s*(am|pm)?$/.exec(s);
  if (!m) return null;
  let h = Number(m[1]);
  const min = m[2] ? Number(m[2]) : 0;
  if (m[3] === "pm" && h < 12) h += 12;
  if (m[3] === "am" && h === 12) h = 0;
  if (h > 23 || min > 59) return null;
  return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}:00`;
}

export function isISODate(v: unknown): v is string {
  return typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v));
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface Resolved<T> { match: T | null; candidates: T[] }

/** Customer by id or (case-insensitive, partial) name. One hit = match; several = candidates. */
export async function resolveCustomer(db: SupabaseClient, raw: string): Promise<Resolved<{ id: string; name: string }>> {
  if (UUID.test(raw)) {
    const { data } = await db.from("customers").select("id, name").eq("id", raw).maybeSingle();
    return { match: data ?? null, candidates: [] };
  }
  const q = raw.trim();
  const { data } = await db.from("customers").select("id, name").eq("is_active", true).ilike("name", `%${q}%`).order("name").limit(10);
  const rows = data ?? [];
  const exact = rows.filter((r) => r.name.toLowerCase() === q.toLowerCase());
  if (exact.length === 1) return { match: exact[0], candidates: [] };
  return rows.length === 1 ? { match: rows[0], candidates: [] } : { match: null, candidates: rows };
}

export interface SiteHit { id: string; name: string; suburb: string | null; customer_id: string; customer: string | null }

/** Site by id or name (optionally within a customer). "Planet Fitness Caboolture" also matches customer "Planet Fitness" + site "Caboolture". */
export async function resolveSite(db: SupabaseClient, raw: string, customerId?: string | null): Promise<Resolved<SiteHit>> {
  const sel = "id, name, suburb, customer_id, customer:customers(name)";
  const shape = (r: { id: string; name: string; suburb: string | null; customer_id: string; customer: Rel<{ name: string }> }): SiteHit =>
    ({ id: r.id, name: r.name, suburb: r.suburb, customer_id: r.customer_id, customer: one(r.customer)?.name ?? null });
  if (UUID.test(raw)) {
    const { data } = await db.from("customer_sites").select(sel).eq("id", raw).maybeSingle();
    return { match: data ? shape(data) : null, candidates: [] };
  }
  const q = raw.trim();
  let query = db.from("customer_sites").select(sel).ilike("name", `%${q}%`).order("name").limit(10);
  if (customerId) query = query.eq("customer_id", customerId);
  let rows = ((await query).data ?? []).map(shape);

  // "Planet Fitness Caboolture" → try the trailing words as the site name once the customer is known.
  if (!rows.length && !customerId) {
    const words = q.split(/\s+/);
    for (let i = 1; i < words.length && !rows.length; i++) {
      const custPart = words.slice(0, i).join(" "), sitePart = words.slice(i).join(" ");
      const cust = await resolveCustomer(db, custPart);
      if (!cust.match) continue;
      const { data } = await db.from("customer_sites").select(sel).eq("customer_id", cust.match.id).ilike("name", `%${sitePart}%`).order("name").limit(10);
      rows = (data ?? []).map(shape);
    }
  }
  // Suburb fallback.
  if (!rows.length) {
    let q2 = db.from("customer_sites").select(sel).ilike("suburb", `%${q}%`).order("name").limit(10);
    if (customerId) q2 = q2.eq("customer_id", customerId);
    rows = ((await q2).data ?? []).map(shape);
  }
  const exact = rows.filter((r) => r.name.toLowerCase() === q.toLowerCase());
  if (exact.length === 1) return { match: exact[0], candidates: [] };
  return rows.length === 1 ? { match: rows[0], candidates: [] } : { match: null, candidates: rows };
}

export interface StaffHit { id: string; display_name: string; email: string | null }

/** Staff by email, display name or first name. Defaults to Mark when nothing is given. */
export async function resolveStaff(db: SupabaseClient, names: string[]): Promise<{ found: StaffHit[]; missing: string[] }> {
  const { data } = await db.from("staff").select("id, display_name, email").eq("is_active", true);
  const all = (data ?? []) as StaffHit[];
  const found: StaffHit[] = [];
  const missing: string[] = [];
  for (const raw of names) {
    const q = raw.trim().toLowerCase();
    if (!q) continue;
    const hit =
      all.find((s) => s.email?.toLowerCase() === q || s.id === q) ??
      all.find((s) => s.display_name.toLowerCase() === q) ??
      all.find((s) => s.display_name.toLowerCase().split(/\s+/)[0] === q) ??
      all.find((s) => s.display_name.toLowerCase().includes(q));
    if (hit) { if (!found.some((f) => f.id === hit.id)) found.push(hit); } else missing.push(raw);
  }
  return { found, missing };
}

export async function markStaff(db: SupabaseClient): Promise<StaffHit | null> {
  const { data } = await db.from("staff").select("id, display_name, email").eq("email", "mark@centrefit.com.au").maybeSingle();
  return (data as StaffHit | null) ?? null;
}

export async function statusIdByName(db: SupabaseClient, name: string): Promise<string | null> {
  const { data } = await db.from("statuses").select("id").eq("name", name).maybeSingle();
  return data?.id ?? null;
}

export async function categoryIdByName(db: SupabaseClient, type: "job_type" | "business_unit", name: string): Promise<string | null> {
  const { data } = await db.from("categories").select("id, name").eq("type", type).eq("is_active", true).ilike("name", `%${name.trim()}%`).limit(5);
  const rows = data ?? [];
  const exact = rows.find((r) => r.name.toLowerCase() === name.trim().toLowerCase());
  return exact?.id ?? (rows.length === 1 ? rows[0].id : null);
}

export async function fetchJobByNumber(db: SupabaseClient, number: string): Promise<JobRow | null> {
  const { data } = await db.from("jobs").select(JOB_SELECT).eq("number", number).maybeSingle();
  return (data as unknown as JobRow | null) ?? null;
}
