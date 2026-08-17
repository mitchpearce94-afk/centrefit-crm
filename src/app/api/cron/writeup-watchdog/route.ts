import { NextRequest, NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { enqueueNotification } from "@/lib/notifications/enqueue";
import { brisbaneDateISO } from "@/lib/dates";

/**
 * Weekday ~4:30pm AEST — the unfilled write-up nudge (Mitchell 2026-08-18).
 *
 * A job counts as "worked today" when it has a time entry started today or a
 * plan-checklist tick (rough-in or fit-off) today. If such a job has NO
 * job_work_entries row dated today, every tech who logged that activity gets
 * a job.writeup_missing notification (bell + email) deep-linking to the job,
 * before they've left the car park. Falls back to the job's assigned staff
 * when the activity rows don't carry a staff id.
 *
 * Deliberately per-day: running once daily means at most one nudge per
 * job per day, no extra dedupe state needed.
 *
 * Auth: X-Cf-Cron-Secret (or Bearer) matches CRON_SECRET.
 */

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const provided =
    req.headers.get("x-cf-cron-secret") ??
    req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!secret) {
    return NextResponse.json({ error: "CRON_SECRET not configured" }, { status: 500 });
  }
  if (provided !== secret) {
    return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  }

  const svc = createServiceRoleClient();
  const today = brisbaneDateISO(new Date());
  const dayStartIso = new Date(`${today}T00:00:00+10:00`).toISOString();

  // Who worked which job today?
  const workedBy = new Map<string, Set<string>>();
  const touch = (jobId: string | null, staffId: string | null) => {
    if (!jobId) return;
    if (!workedBy.has(jobId)) workedBy.set(jobId, new Set());
    if (staffId) workedBy.get(jobId)!.add(staffId);
  };

  const { data: timeRows } = await svc
    .from("job_time")
    .select("job_id, staff_id")
    .gte("start_time", dayStartIso);
  for (const r of timeRows ?? []) touch(r.job_id, r.staff_id);

  const { data: tickRows } = await svc
    .from("plan_items")
    .select("job_id, installed_by, installed_at, roughed_in_by, roughed_in_at")
    .not("job_id", "is", null)
    .or(`installed_at.gte.${dayStartIso},roughed_in_at.gte.${dayStartIso}`);
  for (const r of tickRows ?? []) {
    if (r.installed_at && r.installed_at >= dayStartIso) touch(r.job_id, r.installed_by);
    if (r.roughed_in_at && r.roughed_in_at >= dayStartIso) touch(r.job_id, r.roughed_in_by);
  }

  const jobIds = [...workedBy.keys()];
  if (jobIds.length === 0) {
    return NextResponse.json({ ok: true, worked: 0, nudged: 0 });
  }

  // Which of those already have today's write-up?
  const { data: entries } = await svc
    .from("job_work_entries")
    .select("job_id")
    .in("job_id", jobIds)
    .eq("work_date", today);
  const covered = new Set((entries ?? []).map((e) => e.job_id));
  const missing = jobIds.filter((id) => !covered.has(id));
  if (missing.length === 0) {
    return NextResponse.json({ ok: true, worked: jobIds.length, nudged: 0 });
  }

  const { data: jobs } = await svc
    .from("jobs")
    .select("id, number, reference, customer:customers(name), site:customer_sites(name)")
    .in("id", missing);

  let nudged = 0;
  for (const job of jobs ?? []) {
    let staffIds = [...(workedBy.get(job.id) ?? [])];
    if (staffIds.length === 0) {
      const { data: assigned } = await svc
        .from("job_staff")
        .select("staff_id")
        .eq("job_id", job.id);
      staffIds = (assigned ?? []).map((a) => a.staff_id);
    }
    if (staffIds.length === 0) continue;

    const customer = Array.isArray(job.customer) ? job.customer[0] : job.customer;
    const site = Array.isArray(job.site) ? job.site[0] : job.site;
    const where = site?.name ?? customer?.name ?? job.reference ?? "site";

    await enqueueNotification({
      supabase: svc,
      typeCode: "job.writeup_missing",
      refType: "job",
      refId: job.id,
      audience: { staffIds },
      title: `Wrap up ${job.number}?`,
      body: `You were at ${where} today and Work Completed is still empty — 60 seconds now beats trying to remember next week.`,
      href: `/jobs/${job.id}`,
      emailDetails: [
        { label: "Job", value: job.number ?? "" },
        { label: "Customer", value: customer?.name ?? "" },
        { label: "Site", value: site?.name ?? "" },
      ],
      ctaLabel: job.number ? `Wrap up ${job.number}` : "Wrap up the job",
    });
    nudged++;
  }

  return NextResponse.json({ ok: true, worked: jobIds.length, missing: missing.length, nudged });
}
