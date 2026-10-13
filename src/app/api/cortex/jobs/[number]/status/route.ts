import { NextRequest } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { cortexGate, ok, bad, readJsonBody } from "@/lib/cortex-api/auth";
import { normaliseJobNumber, fetchJobByNumber, markStaff, statusIdByName, shapeJob, one } from "@/lib/cortex-api/jobs";
import { enqueueNotification } from "@/lib/notifications/enqueue";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Statuses Mark's Cortex may set. Everything else stays a human decision in the CRM. */
const ALLOWED = ["Ready to Invoice", "Complete", "No Charge", "In Progress", "Scheduled", "Follow Up", "On Hold"];

/**
 * POST /api/cortex/jobs/CFA05256/status  { status, reason?, note? }
 * Moves a job. The DB write-up gate applies: Ready to Invoice / Complete
 * with an empty Work Completed log is refused (409, WRITEUP_REQUIRED).
 * "No Charge" needs a reason — it's written to the job and the note log.
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
  const status = typeof b.status === "string" ? b.status.trim() : "";
  const reason = typeof b.reason === "string" ? b.reason.trim() : "";
  const note = typeof b.note === "string" ? b.note.trim() : "";
  if (!ALLOWED.includes(status)) return bad(`status must be one of: ${ALLOWED.join(", ")}`);
  if (status === "No Charge" && !reason) return bad("No Charge needs a reason (who decided, and why).");
  const targetId = await statusIdByName(db, status);
  if (!targetId) return bad(`Status "${status}" missing`, 500);
  const from = one(job.status)?.name ?? "(none)";
  if (from === status) return ok({ changed: false, number, status });

  const mark = await markStaff(db);
  const patch: Record<string, unknown> = { status_id: targetId };
  if (status === "No Charge") patch.no_charge_reason = reason;
  const { error } = await db.from("jobs").update(patch).eq("id", job.id);
  if (error) {
    const gated = /WRITEUP_REQUIRED/.test(error.message);
    return bad(error.message.replace(/^.*WRITEUP_REQUIRED:\s*/, ""), gated ? 409 : 500, gated ? { code: "WRITEUP_REQUIRED" } : undefined);
  }

  await db.from("job_notes").insert({
    job_id: job.id,
    staff_id: mark?.id ?? null,
    content: `Status changed from "${from}" to "${status}" via Cortex${status === "No Charge" ? ` — no charge: ${reason}` : ""}${note ? ` — ${note}` : ""}`,
    type: "system",
    is_system: true,
  });

  const typeCode = status === "Ready to Invoice" ? "job.ready_to_invoice" : status === "Complete" ? "job.complete" : null;
  if (typeCode) {
    const customer = one(job.customer)?.name ?? "";
    const site = one(job.site)?.name ?? "";
    try {
      await enqueueNotification({
        typeCode, refType: "job", refId: job.id, audience: { allActive: true },
        title: status === "Ready to Invoice" ? `Job ${number} ready to invoice` : `Job ${number} completed`,
        body: [customer, site].filter(Boolean).join(" — ") || undefined,
        href: `/jobs/${job.id}`,
        emailDetails: [{ label: "Job", value: number }, { label: "Customer", value: customer }, { label: "Site", value: site }, { label: "Status", value: status }],
        ctaLabel: `View Job ${number}`,
      });
    } catch (err) { console.error("[cortex status] notify failed", err); }
  }

  const full = await fetchJobByNumber(db, number);
  return ok({ changed: true, number, from, status, job: full ? shapeJob(full) : null });
}
