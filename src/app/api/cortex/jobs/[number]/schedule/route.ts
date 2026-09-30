import { NextRequest } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { cortexGate, ok, bad, readJsonBody } from "@/lib/cortex-api/auth";
import { shapeJob, normaliseJobNumber, normaliseTime, isISODate, fetchJobByNumber, resolveStaff, markStaff, statusIdByName, one } from "@/lib/cortex-api/jobs";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * POST /api/cortex/jobs/CFA05256/schedule
 *   { date, end_date?, start?, end?, staff?: string[] | string, notes? }
 * Adds a diary entry (one per staff member; Mark by default), makes sure the
 * staff are on the job, and moves an Unassigned/Assigned/Pending Schedule job
 * to Scheduled. Never removes or edits existing entries.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ number: string }> }) {
  const denied = cortexGate(req);
  if (denied) return denied;
  const { number: raw } = await ctx.params;
  const number = normaliseJobNumber(raw);
  if (!number) return bad(`"${raw}" is not a job number`);
  const db = createServiceRoleClient();
  const job = await fetchJobByNumber(db, number);
  if (!job) return bad(`No job ${number}`, 404);

  const b = await readJsonBody(req);
  if (!isISODate(b.date)) return bad("date must be YYYY-MM-DD");
  if (b.end_date != null && !isISODate(b.end_date)) return bad("end_date must be YYYY-MM-DD");
  const start = b.start != null ? normaliseTime(b.start) : null;
  const end = b.end != null ? normaliseTime(b.end) : null;
  if ((b.start != null && !start) || (b.end != null && !end)) return bad("start / end must be times like 08:00 or 2pm");

  const staffRaw = Array.isArray(b.staff) ? (b.staff as unknown[]).map(String) : typeof b.staff === "string" && b.staff.trim() ? [b.staff.trim()] : [];
  const mark = await markStaff(db);
  const staff = staffRaw.length ? await resolveStaff(db, staffRaw) : { found: mark ? [mark] : [], missing: [] };
  if (staff.missing.length) return bad(`Unknown staff: ${staff.missing.join(", ")}`, 404);
  if (!staff.found.length) return bad("No staff to schedule", 400);

  const rows = staff.found.map((st) => ({
    job_id: job.id, staff_id: st.id, entry_type: "job", schedule_date: b.date, end_date: (b.end_date as string | undefined) ?? null,
    start_time: start, end_time: end, notes: typeof b.notes === "string" ? b.notes.trim() || null : null, created_by: mark?.id ?? null,
  }));
  const { error } = await db.from("schedule_entries").insert(rows);
  if (error) return bad(error.message, 500);

  // Make sure they're on the job.
  const { data: existing } = await db.from("job_staff").select("staff_id").eq("job_id", job.id);
  const have = new Set((existing ?? []).map((r) => r.staff_id));
  const add = staff.found.filter((st) => !have.has(st.id)).map((st) => ({ job_id: job.id, staff_id: st.id, role: "assigned" }));
  if (add.length) await db.from("job_staff").insert(add);

  const current = one(job.status)?.name ?? "";
  if (["Unassigned", "Assigned", "Pending Schedule"].includes(current)) {
    const sid = await statusIdByName(db, "Scheduled");
    if (sid) await db.from("jobs").update({ status_id: sid, updated_at: new Date().toISOString() }).eq("id", job.id);
  }

  const full = await fetchJobByNumber(db, number);
  return ok({ scheduled: true, job: full ? shapeJob(full) : null }, 201);
}
