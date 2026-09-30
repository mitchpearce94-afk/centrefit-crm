import { NextRequest } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { cortexGate, ok, bad, readJsonBody } from "@/lib/cortex-api/auth";
import { normaliseJobNumber, fetchJobByNumber, markStaff } from "@/lib/cortex-api/jobs";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** POST /api/cortex/jobs/CFA05256/updates  { content } — adds a job update in Mark's name. */
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
  const content = typeof b.content === "string" ? b.content.trim() : "";
  if (!content) return bad("content required");
  const mark = await markStaff(db);
  const { error } = await db.from("job_updates").insert({ job_id: job.id, staff_id: mark?.id ?? null, content: content.slice(0, 4000) });
  if (error) return bad(error.message, 500);
  return ok({ added: true, number }, 201);
}
