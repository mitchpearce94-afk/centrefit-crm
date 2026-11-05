import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isProgressStepKey } from "@/lib/jobs/progress";

/**
 * POST /api/jobs/[id]/progress — tick a lifecycle step by hand, mark it N/A,
 * or clear a manual mark (docs/job-lifecycle-CONTEXT.md D5).
 *
 * Body: { stepKey, state: "done" | "na" | "clear", note? }
 *
 * Auto steps are computed from the data; a manual "done" on one of those is
 * an override that shows as "ticked by SC 05/11/26" rather than the data
 * proof. Writes go through the user's own client so RLS
 * (jobs.update_status) applies the same as the install checklist.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: jobId } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const stepKey = String(body?.stepKey ?? "");
  const state = String(body?.state ?? "");
  const note = typeof body?.note === "string" ? body.note.trim().slice(0, 500) || null : null;
  if (!isProgressStepKey(stepKey)) return NextResponse.json({ error: "Unknown step" }, { status: 400 });
  if (!["done", "na", "clear"].includes(state)) return NextResponse.json({ error: "state must be done, na or clear" }, { status: 400 });

  if (state === "clear") {
    const { error } = await supabase.from("job_progress_items").delete().eq("job_id", jobId).eq("step_key", stepKey);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  const { data: staffRow } = await supabase.from("staff").select("initials").eq("id", user.id).maybeSingle();
  const today = new Date().toLocaleDateString("en-AU", { day: "2-digit", month: "2-digit", year: "2-digit", timeZone: "Australia/Brisbane" });
  const byText = `${staffRow?.initials ?? "??"} ${today}`;

  const { error } = await supabase
    .from("job_progress_items")
    .upsert(
      {
        job_id: jobId,
        step_key: stepKey,
        state,
        done_by_staff_id: user.id,
        done_by_text: byText,
        done_at: new Date().toISOString(),
        note,
      },
      { onConflict: "job_id,step_key" },
    );
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, by: byText });
}
