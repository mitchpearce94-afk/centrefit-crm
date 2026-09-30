import { NextRequest } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { cortexGate, ok, bad, readJsonBody } from "@/lib/cortex-api/auth";
import {
  JOB_SELECT, shapeJob, normaliseJobNumber, normaliseTime, isISODate,
  resolveCustomer, resolveSite, resolveStaff, markStaff, statusIdByName, categoryIdByName, fetchJobByNumber,
  type JobRow,
} from "@/lib/cortex-api/jobs";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET  /api/cortex/jobs?q=&status=&staff=&from=&to=&limit=
 *   Search jobs (number, reference, description, customer or site name).
 *   `from`/`to` filter on scheduled dates; `staff` on assigned staff name.
 * POST /api/cortex/jobs
 *   Create (and optionally schedule) a job. docs/cortex-api.md.
 */
export async function GET(req: NextRequest) {
  const denied = cortexGate(req);
  if (denied) return denied;
  const db = createServiceRoleClient();
  const p = req.nextUrl.searchParams;
  const q = (p.get("q") ?? "").trim();
  const status = (p.get("status") ?? "").trim();
  const staff = (p.get("staff") ?? "").trim();
  const from = p.get("from"), to = p.get("to");
  const limit = Math.min(Math.max(Number(p.get("limit") ?? 25) || 25, 1), 50);

  let query = db.from("jobs").select(JOB_SELECT).order("created_at", { ascending: false }).limit(limit);

  if (q) {
    const num = normaliseJobNumber(q);
    if (num) {
      query = query.eq("number", num);
    } else {
      const like = `%${q}%`;
      const [custs, sites] = await Promise.all([
        db.from("customers").select("id").ilike("name", like).limit(50),
        db.from("customer_sites").select("id").or(`name.ilike.${like},suburb.ilike.${like}`).limit(100),
      ]);
      const custIds = (custs.data ?? []).map((r) => r.id);
      const siteIds = (sites.data ?? []).map((r) => r.id);
      const ors = [`reference.ilike.${like}`, `description.ilike.${like}`];
      if (custIds.length) ors.push(`customer_id.in.(${custIds.join(",")})`);
      if (siteIds.length) ors.push(`site_id.in.(${siteIds.join(",")})`);
      query = query.or(ors.join(","));
    }
  }
  if (status) {
    const sid = await statusIdByName(db, status);
    if (!sid) return bad(`Unknown status "${status}"`, 404);
    query = query.eq("status_id", sid);
  }

  const { data, error } = await query;
  if (error) return bad(error.message, 500);
  let jobs = ((data ?? []) as unknown as JobRow[]).map(shapeJob);
  if (staff) jobs = jobs.filter((j) => j.staff.some((s) => String(s).toLowerCase().includes(staff.toLowerCase())));
  if (isISODate(from)) jobs = jobs.filter((j) => j.schedule.some((s) => (s.end_date ?? s.date) >= from));
  if (isISODate(to)) jobs = jobs.filter((j) => j.schedule.some((s) => s.date <= to));
  return ok({ count: jobs.length, jobs });
}

export async function POST(req: NextRequest) {
  const denied = cortexGate(req);
  if (denied) return denied;
  const db = createServiceRoleClient();
  const b = await readJsonBody(req);
  const str = (k: string) => (typeof b[k] === "string" ? (b[k] as string).trim() : "");

  const siteRaw = str("site"), customerRaw = str("customer");
  if (!siteRaw && !customerRaw) return bad("Give a site (and/or customer) for the job.");

  // Customer → site (a site alone is fine: the customer comes from it).
  let customerId: string | null = null;
  if (customerRaw) {
    const c = await resolveCustomer(db, customerRaw);
    if (!c.match) return bad(c.candidates.length ? `Which customer? ${c.candidates.map((x) => x.name).join(" / ")}` : `No customer matches "${customerRaw}"`, c.candidates.length ? 409 : 404, { candidates: c.candidates });
    customerId = c.match.id;
  }
  if (!siteRaw) return bad("Give the site for the job (a job always belongs to a site).");
  const s = await resolveSite(db, siteRaw, customerId);
  if (!s.match) return bad(s.candidates.length ? `Which site? ${s.candidates.map((x) => `${x.customer ?? "?"} — ${x.name}`).join(" / ")}` : `No site matches "${siteRaw}"`, s.candidates.length ? 409 : 404, { candidates: s.candidates });
  const site = s.match;
  customerId = customerId ?? site.customer_id;

  // Staff (default Mark) and the schedule window.
  const staffRaw = Array.isArray(b.staff) ? (b.staff as unknown[]).map(String) : str("staff") ? [str("staff")] : [];
  const mark = await markStaff(db);
  const staffRes = staffRaw.length ? await resolveStaff(db, staffRaw) : { found: mark ? [mark] : [], missing: [] };
  if (staffRes.missing.length) return bad(`Unknown staff: ${staffRes.missing.join(", ")}`, 404);

  const sched = b.schedule && typeof b.schedule === "object" ? (b.schedule as Record<string, unknown>) : null;
  let entry: { schedule_date: string; end_date: string | null; start_time: string | null; end_time: string | null; notes: string | null } | null = null;
  if (sched) {
    if (!isISODate(sched.date)) return bad("schedule.date must be YYYY-MM-DD");
    const start = sched.start != null ? normaliseTime(sched.start) : null;
    const end = sched.end != null ? normaliseTime(sched.end) : null;
    if ((sched.start != null && !start) || (sched.end != null && !end)) return bad("schedule.start / schedule.end must be times like 08:00 or 2pm");
    if (sched.end_date != null && !isISODate(sched.end_date)) return bad("schedule.end_date must be YYYY-MM-DD");
    entry = { schedule_date: sched.date, end_date: (sched.end_date as string | undefined) ?? null, start_time: start, end_time: end, notes: typeof sched.notes === "string" ? sched.notes.trim() || null : null };
  }

  const category1 = str("category") ? await categoryIdByName(db, "job_type", str("category")) : null;
  if (str("category") && !category1) return bad(`Unknown job category "${str("category")}"`, 404);
  const category2 = (await categoryIdByName(db, "business_unit", str("business_unit") || "Services")) ?? null;
  const statusName = entry ? "Scheduled" : staffRes.found.length ? "Assigned" : "Unassigned";
  const statusId = await statusIdByName(db, statusName);
  if (!statusId) return bad(`Status "${statusName}" missing`, 500);

  const description = str("description") || null;
  const reference = str("reference") || (description ? description.slice(0, 80) : null);
  if (!reference && !description) return bad("Give a reference or description for the job.");

  const { data: job, error } = await db
    .from("jobs")
    .insert({
      customer_id: customerId,
      site_id: site.id,
      reference,
      description,
      category_1_id: category1,
      category_2_id: category2,
      status_id: statusId,
      due_date: isISODate(b.due_date) ? b.due_date : null,
      created_by: mark?.id ?? null,
    })
    .select("id, number")
    .single();
  if (error || !job) return bad(error?.message ?? "Failed to create job", 500);

  if (staffRes.found.length) {
    await db.from("job_staff").insert(staffRes.found.map((st) => ({ job_id: job.id, staff_id: st.id, role: "assigned" })));
  }
  if (entry) {
    const rows = (staffRes.found.length ? staffRes.found : [{ id: null as string | null }]).map((st) => ({
      job_id: job.id, staff_id: st.id, entry_type: "job", created_by: mark?.id ?? null, ...entry,
    }));
    const { error: schedErr } = await db.from("schedule_entries").insert(rows);
    if (schedErr) return bad(`Job ${job.number} created but the schedule entry failed: ${schedErr.message}`, 500, { number: job.number });
  }

  const full = await fetchJobByNumber(db, job.number);
  return ok({ created: true, job: full ? shapeJob(full) : { number: job.number } }, 201);
}
