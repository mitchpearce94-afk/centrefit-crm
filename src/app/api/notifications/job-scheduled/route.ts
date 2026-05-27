import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { enqueueNotification } from "@/lib/notifications/enqueue";

/**
 * Fire job.scheduled notifications targeted at the staff who just got
 * scheduled. Called from assign-job-modal after the schedule_entries
 * insert/update lands. Targets the actual assignees only — not the
 * whole team — so Michael only hears the bell when he is scheduled
 * to do something, not every time anyone schedules anything.
 *
 * Auth: authenticated CRM user (the person doing the scheduling).
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const { jobId, staffIds, scheduleDate, startTime, endTime } = body ?? {};

  if (!jobId || typeof jobId !== "string") {
    return NextResponse.json({ error: "jobId required" }, { status: 400 });
  }
  if (!Array.isArray(staffIds) || staffIds.length === 0) {
    return NextResponse.json({ error: "staffIds must be a non-empty array" }, { status: 400 });
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  // Pull job context for the notification body so the assignee sees what
  // they were actually scheduled for — the bell title needs to be useful
  // on its own without clicking through.
  const { data: job } = await supabase
    .from("jobs")
    .select(`
      id, number, reference,
      customer:customers(name),
      site:customer_sites(name)
    `)
    .eq("id", jobId)
    .maybeSingle();
  if (!job) {
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }
  const customer = Array.isArray(job.customer) ? job.customer[0] : job.customer;
  const site = Array.isArray(job.site) ? job.site[0] : job.site;

  // Filter out the user who's doing the scheduling — they already know,
  // they just clicked save. Pinging yourself is just noise.
  const targets = (staffIds as string[]).filter((id) => id !== user.id);
  if (targets.length === 0) {
    return NextResponse.json({ ok: true, skipped: "self_only" });
  }

  const dateLabel = scheduleDate
    ? new Date(scheduleDate + "T00:00:00").toLocaleDateString("en-AU", {
        weekday: "short",
        day: "numeric",
        month: "short",
      })
    : null;
  const timeLabel =
    startTime && endTime
      ? `${startTime.slice(0, 5)}–${endTime.slice(0, 5)}`
      : startTime
        ? startTime.slice(0, 5)
        : null;
  const when = [dateLabel, timeLabel].filter(Boolean).join(" · ");

  const where =
    site?.name && customer?.name
      ? `${customer.name} — ${site.name}`
      : (customer?.name ?? site?.name ?? "Unknown site");

  await enqueueNotification({
    supabase,
    typeCode: "job.scheduled",
    refType: "job",
    refId: jobId,
    audience: { staffIds: targets },
    title: `Scheduled: ${job.number}${when ? ` · ${when}` : ""}`,
    body: `${where}${job.reference ? ` · ${job.reference}` : ""}`,
    href: `/jobs/${jobId}`,
  });

  return NextResponse.json({ ok: true, notified: targets.length });
}
