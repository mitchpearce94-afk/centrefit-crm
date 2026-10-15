import { NextRequest, NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { buildWorkStatusReport } from "@/lib/work-status/report";
import { sendWorkStatusEmail, renderWorkStatusEmail, type WorkStatusEmailInput } from "@/lib/emails/work-status-report";

/**
 * Weekday 4:00pm AEST (vercel.json `0 6 * * 1-5`) — the work status report
 * (Mark, 14 Oct 2026). Everyone gets only their own jobs, admins included
 * (Mitchell, 15 Oct 2026: "only send the person their own job, not everyone
 * to everyone") — except the FULL_REPORT_TO addresses (default Mark), who get
 * the whole report, even when it's clean. Override with
 * WORK_STATUS_FULL_REPORT_TO (comma-separated emails). Per-staff opt-out via
 * the `job.work_status_report` notification preference (email_enabled =
 * false). Silent for a person with nothing on their list — the all-clear is
 * the absence of the email.
 *
 * ?dry=1      → build + return JSON, send nothing, persist nothing
 * ?preview=1  → return the whole-report HTML (no send, no persist)
 * ?to=email   → send that person exactly what the 4pm run would send them
 *               (their own slice; 404-style JSON if they'd get nothing),
 *               still no persist
 *
 * Auth: X-Cf-Cron-Secret (or Bearer) matches CRON_SECRET.
 */

const TYPE_CODE = "job.work_status_report";
const FULL_REPORT_TO = new Set(
  (process.env.WORK_STATUS_FULL_REPORT_TO ?? "mark@centrefit.com.au").split(",").map((e) => e.trim().toLowerCase()).filter(Boolean),
);
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 120;

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const provided = req.headers.get("x-cf-cron-secret") ?? req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!secret) return NextResponse.json({ error: "CRON_SECRET not configured" }, { status: 500 });
  if (provided !== secret) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });

  const p = req.nextUrl.searchParams;
  const dry = p.get("dry") === "1", preview = p.get("preview") === "1", only = (p.get("to") ?? "").trim().toLowerCase();
  const svc = createServiceRoleClient();
  const appBaseUrl = (process.env.NEXT_PUBLIC_APP_URL ?? "https://crm.centrefit.com.au").replace(/\/$/, "");
  const report = await buildWorkStatusReport(svc, { persist: !(dry || preview || only), appBaseUrl });
  const dateLabel = new Date(report.date + "T00:00:00+10:00").toLocaleDateString("en-AU", { timeZone: "Australia/Brisbane", weekday: "short", day: "numeric", month: "short" });

  if (dry) return NextResponse.json({ ok: true, dry: true, ...report });

  const { data: prefs } = await svc.from("staff_notification_preferences").select("staff_id, email_enabled").eq("type_code", TYPE_CODE);
  const muted = new Set((prefs ?? []).filter((r) => r.email_enabled === false).map((r) => r.staff_id as string));

  if (preview) {
    const { html } = renderWorkStatusEmail({ report, scope: { kind: "all" }, to: "", greetingName: "", dateLabel });
    return new NextResponse(html, { headers: { "content-type": "text/html; charset=utf-8" } });
  }

  const results: { to: string; scope: string; items: number; ok: boolean; error?: string }[] = [];
  for (const s of report.staff) {
    if (!s.email || s.is_external) continue;
    const email = s.email.toLowerCase();
    if (only && email !== only) continue;
    if (!only && muted.has(s.id)) continue;
    const bucket = report.by_staff.find((b) => b.staff_id === s.id);
    let scope: WorkStatusEmailInput["scope"];
    if (FULL_REPORT_TO.has(email)) scope = { kind: "all" };
    else if (bucket) scope = { kind: "staff", bucket };
    else {
      if (only) return NextResponse.json({ ok: true, date: report.date, sent: [], note: `${email} has nothing on their list — the 4pm run would send them nothing` });
      continue; // nothing on their list — silence is the all-clear
    }
    const r = await sendWorkStatusEmail({ report, scope, to: email, greetingName: s.name.split(" ")[0], dateLabel });
    results.push({ to: email, scope: scope.kind, items: scope.kind === "all" ? report.items.length : scope.bucket.items.length, ok: r.ok, error: r.ok ? undefined : r.error });
  }
  return NextResponse.json({ ok: true, date: report.date, counts: report.counts, checked: report.checked, sent: results });
}
