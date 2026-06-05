import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { autoTransitionJobStatusServer } from "@/lib/job-status-transitions.server";
import { enqueueNotification } from "@/lib/notifications/enqueue";

/**
 * POST /api/jobs/[id]/assign-staff — tag a staff member onto a job and notify
 * them (regardless of whether they're scheduled). Body: { staffId }.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: jobId } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const staffId = (body?.staffId ?? "").toString().trim();
  if (!staffId) return NextResponse.json({ error: "staffId is required" }, { status: 400 });

  const { error: insErr } = await supabase
    .from("job_staff")
    .insert({ job_id: jobId, staff_id: staffId });
  if (insErr) return NextResponse.json({ error: insErr.message }, { status: 500 });

  await autoTransitionJobStatusServer(jobId, "staff_assigned", supabase);

  // Notify the tagged staffer — but not if they tagged themselves.
  if (staffId !== user.id) {
    const svc = createServiceRoleClient();
    const { data: job } = await svc.from("jobs").select("number").eq("id", jobId).maybeSingle();
    const { data: me } = await svc.from("staff").select("display_name").eq("id", user.id).maybeSingle();
    const jobLabel = job?.number ?? "a job";
    const by = me?.display_name ? ` by ${me.display_name}` : "";
    await enqueueNotification({
      supabase: svc,
      typeCode: "job.assigned",
      refType: "job",
      refId: jobId,
      audience: { staffId },
      title: `You've been added to ${jobLabel}`,
      body: `You were tagged onto ${jobLabel}${by}.`,
      href: `/jobs/${jobId}`,
    });
  }

  return NextResponse.json({ ok: true });
}
