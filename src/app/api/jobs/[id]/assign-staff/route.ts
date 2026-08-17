import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { autoTransitionJobStatusServer } from "@/lib/job-status-transitions.server";
import { enqueueNotification } from "@/lib/notifications/enqueue";

/**
 * POST /api/jobs/[id]/assign-staff — tag a staff member onto a job and notify
 * them. Body: { staffId, scheduleDate?, startTime?, endTime? }.
 *
 * When scheduleDate is supplied the route also creates a schedule_entries row
 * so the job tile appears on the scheduler (Mitchell 2026-08-17: assigning
 * from the job wrote job_staff only and no tile ever showed). The tile insert
 * needs scheduler.manage — if RLS refuses it, the assignment still succeeds
 * and the response carries scheduled:false so the UI can say so instead of
 * failing silently.
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

  const scheduleDate = (body?.scheduleDate ?? "").toString().trim();
  const startTime = (body?.startTime ?? "").toString().trim();
  const endTime = (body?.endTime ?? "").toString().trim();
  if (scheduleDate && !/^\d{4}-\d{2}-\d{2}$/.test(scheduleDate)) {
    return NextResponse.json({ error: "scheduleDate must be YYYY-MM-DD" }, { status: 400 });
  }
  const validTime = (t: string) => /^\d{2}:\d{2}(:\d{2})?$/.test(t);
  if ((startTime && !validTime(startTime)) || (endTime && !validTime(endTime))) {
    return NextResponse.json({ error: "times must be HH:MM" }, { status: 400 });
  }

  const { error: insErr } = await supabase
    .from("job_staff")
    .insert({ job_id: jobId, staff_id: staffId });
  if (insErr) return NextResponse.json({ error: insErr.message }, { status: 500 });

  await autoTransitionJobStatusServer(jobId, "staff_assigned", supabase);

  let scheduled: boolean | undefined;
  let scheduleError: string | undefined;
  if (scheduleDate) {
    const { error: schedErr } = await supabase.from("schedule_entries").insert({
      entry_type: "job",
      job_id: jobId,
      staff_id: staffId,
      schedule_date: scheduleDate,
      start_time: startTime || null,
      end_time: endTime || null,
      created_by: user.id,
    });
    scheduled = !schedErr;
    scheduleError = schedErr?.message;
    if (!schedErr) {
      await autoTransitionJobStatusServer(jobId, "job_scheduled", supabase);
    }
  }

  // Notify the tagged staffer — but not if they tagged themselves.
  if (staffId !== user.id) {
    const svc = createServiceRoleClient();
    const { data: job } = await svc
      .from("jobs")
      .select("number, reference, description, customer:customers(name), site:customer_sites(name)")
      .eq("id", jobId)
      .maybeSingle();
    const { data: me } = await svc.from("staff").select("display_name").eq("id", user.id).maybeSingle();
    const jobLabel = job?.number ?? "a job";
    const by = me?.display_name ? ` by ${me.display_name}` : "";
    const customer = Array.isArray(job?.customer) ? job?.customer[0] : job?.customer;
    const site = Array.isArray(job?.site) ? job?.site[0] : job?.site;
    const scheduledLine = scheduled ? ` Scheduled for ${scheduleDate}${startTime ? ` ${startTime}` : ""}.` : "";
    await enqueueNotification({
      supabase: svc,
      typeCode: "job.assigned",
      refType: "job",
      refId: jobId,
      audience: { staffId },
      title: `You've been added to ${jobLabel}`,
      body: `You were tagged onto ${jobLabel}${by}.${scheduledLine}`,
      href: `/jobs/${jobId}`,
      emailDetails: [
        { label: "Job", value: job?.number ?? "" },
        { label: "Customer", value: customer?.name ?? "" },
        { label: "Site", value: site?.name ?? "" },
        { label: "Reference", value: job?.reference ?? "" },
        { label: "Description", value: job?.description ? String(job.description).slice(0, 200) : "" },
        ...(scheduled ? [{ label: "Scheduled", value: `${scheduleDate}${startTime ? ` ${startTime}` : ""}${endTime ? ` – ${endTime}` : ""}` }] : []),
        { label: "Added by", value: me?.display_name ?? "" },
      ],
      ctaLabel: job?.number ? `View Job ${job.number}` : "View job",
    });
  }

  return NextResponse.json({ ok: true, scheduled, scheduleError });
}
