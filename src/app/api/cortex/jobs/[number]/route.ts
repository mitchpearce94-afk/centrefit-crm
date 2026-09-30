import { NextRequest } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { cortexGate, ok, bad } from "@/lib/cortex-api/auth";
import { shapeJob, normaliseJobNumber, fetchJobByNumber, one } from "@/lib/cortex-api/jobs";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** GET /api/cortex/jobs/CFA05256 — one job with its updates, notes and linked quotes (sell totals only). */
export async function GET(req: NextRequest, ctx: { params: Promise<{ number: string }> }) {
  const denied = cortexGate(req);
  if (denied) return denied;
  const { number: raw } = await ctx.params;
  const number = normaliseJobNumber(raw);
  if (!number) return bad(`"${raw}" is not a job number`);
  const db = createServiceRoleClient();
  const job = await fetchJobByNumber(db, number);
  if (!job) return bad(`No job ${number}`, 404);

  const [updates, notes, quotes] = await Promise.all([
    db.from("job_updates").select("content, created_at, staff:staff!job_updates_staff_id_fkey(display_name)").eq("job_id", job.id).is("archived_at", null).order("created_at", { ascending: false }).limit(20),
    db.from("job_notes").select("title, content, type, created_at, staff:staff(display_name)").eq("job_id", job.id).order("created_at", { ascending: false }).limit(20),
    db.from("quotes").select("ref, status, sent_at, accepted_at, expires_at, total:pricing_snapshot->>totalExGST").eq("job_id", job.id).order("created_at", { ascending: false }).limit(10),
  ]);

  return ok({
    job: shapeJob(job),
    updates: (updates.data ?? []).map((u) => ({ at: u.created_at, by: one(u.staff as { display_name: string } | { display_name: string }[] | null)?.display_name ?? null, content: u.content })),
    notes: (notes.data ?? []).map((n) => ({ at: n.created_at, by: one(n.staff as { display_name: string } | { display_name: string }[] | null)?.display_name ?? null, type: n.type, title: n.title, content: n.content })),
    quotes: (quotes.data ?? []).map((q) => ({ ref: q.ref, status: q.status, total_ex_gst: q.total != null ? Number(q.total) : null, sent_at: q.sent_at, accepted_at: q.accepted_at, expires_at: q.expires_at })),
  });
}
