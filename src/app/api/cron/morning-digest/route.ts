import { NextRequest, NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { brisbaneDateISO } from "@/lib/dates";
import {
  sendMorningDigestEmail,
  type DigestTaskLine,
  type DigestInvoiceLine,
} from "@/lib/emails/morning-digest";

/**
 * Weekday 7:00am AEST — Mitchell's personal morning brief
 * (docs/assistant-CONTEXT.md D3/D4).
 *
 * Does three things, in order:
 *   1. Wakes snoozed tasks whose snooze date has arrived (visual fallback
 *      exists client-side, but the DB should reflect reality).
 *   2. Upserts auto-tasks: one per authorised-but-unsent invoice, one per
 *      stale unsigned mandate. Idempotent via the (owner, source, source_ref)
 *      unique index — a ticked task is never resurrected (D2).
 *   3. Emails the brief — SILENT WHEN EMPTY. No content, no email (D3).
 *
 * Auth: X-Cf-Cron-Secret matches CRON_SECRET.
 */

const OWNER_EMAIL = "mitchell@centrefit.com.au";
const STALE_TASK_DAYS = 7;
const MANDATE_GRACE_DAYS = 3;
const DAY_MS = 86_400_000;

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
  const appBaseUrl = (process.env.NEXT_PUBLIC_APP_URL ?? "https://crm.centrefit.com.au").replace(/\/$/, "");

  const { data: owner } = await svc
    .from("staff")
    .select("id, email")
    .eq("email", OWNER_EMAIL)
    .single();
  if (!owner) {
    return NextResponse.json({ error: `No staff row for ${OWNER_EMAIL}` }, { status: 500 });
  }

  // 1 — wake due snoozes.
  await svc
    .from("personal_tasks")
    .update({ status: "open", snoozed_until: null })
    .eq("owner_id", owner.id)
    .eq("status", "snoozed")
    .lte("snoozed_until", today);

  // 2a — auto-tasks for authorised-but-never-emailed invoices.
  const { data: unsent } = await svc
    .from("invoices")
    .select("id, xero_invoice_number, total, amount_due, customer:customers(name)")
    .eq("status", "authorised")
    .is("sent_at", null)
    .gt("amount_due", 0);
  const unsentRows = (unsent ?? []) as unknown as Array<{
    id: string;
    xero_invoice_number: string | null;
    total: number;
    amount_due: number;
    customer: { name: string } | { name: string }[] | null;
  }>;
  const nameOf = (c: { name: string } | { name: string }[] | null) =>
    (Array.isArray(c) ? c[0]?.name : c?.name) ?? "—";

  if (unsentRows.length > 0) {
    const { error: taskErr } = await svc.from("personal_tasks").upsert(
      unsentRows.map((inv) => ({
        owner_id: owner.id,
        title: `Send ${inv.xero_invoice_number ?? inv.id.slice(0, 8)} to ${nameOf(inv.customer)} ($${Number(inv.amount_due).toFixed(2)})`,
        source: "digest.invoice-unsent",
        source_ref: inv.id,
        href: `/invoices/${inv.id}`,
      })),
      { onConflict: "owner_id,source,source_ref", ignoreDuplicates: true },
    );
    if (taskErr) console.error("[morning-digest] unsent-invoice task upsert:", taskErr);
  }

  // 2b — auto-tasks for stale unsigned mandates (same eligibility as the
  // pending-mandate watchdog: never signed, past the grace window).
  const mandateCutoff = new Date(Date.now() - MANDATE_GRACE_DAYS * DAY_MS).toISOString();
  const { data: pendingPlans } = await svc
    .from("recurring_plans")
    .select(`
      id, created_at,
      customers(name), customer_sites(name),
      recurring_plan_items(price_inc_gst, frequency, quantity)
    `)
    .eq("status", "pending_mandate")
    .is("gc_mandate_id", null)
    .lt("created_at", mandateCutoff);
  const planRows = (pendingPlans ?? []) as unknown as Array<{
    id: string;
    created_at: string;
    customers: { name: string } | { name: string }[] | null;
    customer_sites: { name: string } | { name: string }[] | null;
    recurring_plan_items: Array<{ price_inc_gst: number | string; frequency: string; quantity: number | null }>;
  }>;
  const planMonthly = (p: (typeof planRows)[number]) =>
    (p.recurring_plan_items ?? []).reduce((sum, it) => {
      const factor = it.frequency === "yearly" ? 1 / 12 : it.frequency === "quarterly" ? 1 / 3 : 1;
      return sum + Number(it.price_inc_gst) * (it.quantity ?? 1) * factor;
    }, 0);

  if (planRows.length > 0) {
    const { error: taskErr } = await svc.from("personal_tasks").upsert(
      planRows.map((p) => ({
        owner_id: owner.id,
        title: `Chase mandate — ${nameOf(p.customer_sites) !== "—" ? nameOf(p.customer_sites) : nameOf(p.customers)} ($${planMonthly(p).toFixed(2)}/mo unsigned)`,
        source: "digest.mandate-pending",
        source_ref: p.id,
        href: `/invoices/recurring/${p.id}`,
      })),
      { onConflict: "owner_id,source,source_ref", ignoreDuplicates: true },
    );
    if (taskErr) console.error("[morning-digest] mandate task upsert:", taskErr);
  }

  // 2c — auto-close auto-tasks whose trigger has resolved (Mitchell
  // 2026-08-18: "Chase mandate" tasks stayed open — and kept appearing in
  // the brief as "unsigned" — long after the plan activated). A task the
  // system created, the system must also retire.
  const { data: openAuto } = await svc
    .from("personal_tasks")
    .select("id, source, source_ref")
    .eq("owner_id", owner.id)
    .in("source", ["digest.mandate-pending", "digest.invoice-unsent"])
    .neq("status", "done");
  if (openAuto && openAuto.length > 0) {
    const staleIds: string[] = [];
    const mandateRefs = openAuto.filter((t) => t.source === "digest.mandate-pending").map((t) => t.source_ref);
    if (mandateRefs.length > 0) {
      const { data: refPlans } = await svc
        .from("recurring_plans")
        .select("id, status, gc_mandate_id")
        .in("id", mandateRefs);
      const stillPending = new Set(
        (refPlans ?? []).filter((p) => p.status === "pending_mandate" && !p.gc_mandate_id).map((p) => p.id),
      );
      for (const t of openAuto) {
        if (t.source === "digest.mandate-pending" && !stillPending.has(t.source_ref)) staleIds.push(t.id);
      }
    }
    const invoiceRefs = openAuto.filter((t) => t.source === "digest.invoice-unsent").map((t) => t.source_ref);
    if (invoiceRefs.length > 0) {
      const { data: refInvs } = await svc
        .from("invoices")
        .select("id, status, sent_at, amount_due")
        .in("id", invoiceRefs);
      const stillUnsent = new Set(
        (refInvs ?? []).filter((i) => i.status === "authorised" && !i.sent_at && Number(i.amount_due) > 0).map((i) => i.id),
      );
      for (const t of openAuto) {
        if (t.source === "digest.invoice-unsent" && !stillUnsent.has(t.source_ref)) staleIds.push(t.id);
      }
    }
    if (staleIds.length > 0) {
      await svc
        .from("personal_tasks")
        .update({ status: "done", completed_at: new Date().toISOString() })
        .in("id", staleIds);
    }
  }

  // 3 — compose the brief from LIVE data (never a snapshot).
  const { data: taskData } = await svc
    .from("personal_tasks")
    .select("title, due_date, first_seen_at, href, status, priority")
    .eq("owner_id", owner.id)
    .eq("status", "open");
  const nowMs = Date.now();
  const tasks: DigestTaskLine[] = (taskData ?? [])
    .map((t) => ({
      title: t.title,
      daysOnList: Math.floor((nowMs - new Date(t.first_seen_at).getTime()) / DAY_MS),
      overdue: !!t.due_date && t.due_date < today,
      href: t.href,
      dueToday: t.due_date === today,
      urgent: t.priority === "urgent",
    }))
    // Digest shows what needs attention, not the whole list: overdue, due
    // today, urgent, or gone stale. Fresh dateless tasks stay on the page.
    .filter((t) => t.overdue || t.dueToday || t.urgent || t.daysOnList >= STALE_TASK_DAYS)
    .sort((a, b) => Number(b.overdue) - Number(a.overdue) || b.daysOnList - a.daysOnList)
    .slice(0, 12);

  const { data: overdueData } = await svc
    .from("invoices")
    .select("xero_invoice_number, amount_due, due_date, customer:customers(name)")
    .eq("status", "authorised")
    .gt("amount_due", 0)
    .lt("due_date", today)
    .order("amount_due", { ascending: false });
  const overdueRows = (overdueData ?? []) as unknown as Array<{
    xero_invoice_number: string | null;
    amount_due: number;
    due_date: string;
    customer: { name: string } | { name: string }[] | null;
  }>;
  const overdueTotal = overdueRows.reduce((s, r) => s + Number(r.amount_due), 0);
  const top: DigestInvoiceLine[] = overdueRows.slice(0, 5).map((r) => ({
    ref: r.xero_invoice_number ?? "—",
    customer: nameOf(r.customer),
    amountDue: Number(r.amount_due),
    daysOverdue: Math.max(0, Math.floor((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${r.due_date}T00:00:00Z`)) / DAY_MS)),
  }));

  const unsentTotal = unsentRows.reduce((s, r) => s + Number(r.amount_due), 0);
  const mandateMonthly = planRows.reduce((s, p) => s + planMonthly(p), 0);
  const oldestMandateDays = planRows.length
    ? Math.max(...planRows.map((p) => Math.floor((nowMs - new Date(p.created_at).getTime()) / DAY_MS)))
    : 0;

  // Email triage ledger (Phase 3) — last 24h. Null when the engine has never
  // run, so the digest section stays absent until then.
  const { data: triageRows } = await svc
    .from("email_triage")
    .select("classification, action_taken")
    .gte("created_at", new Date(nowMs - 24 * 3600_000).toISOString());
  const emailTriage = (triageRows ?? []).length
    ? {
        mode: (process.env.TRIAGE_MODE === "live" ? "live" : "observe") as "live" | "observe",
        billsForwarded: triageRows!.filter((r) => r.classification === "bill").length,
        flagged: triageRows!.filter((r) => r.classification === "action").length,
        fyi: triageRows!.filter((r) => r.classification === "fyi").length,
        noise: triageRows!.filter((r) => r.classification === "noise").length,
        errors: triageRows!.filter((r) => r.action_taken === "error").length,
      }
    : null;

  // Unfilled write-ups: jobs worked YESTERDAY (time entries or plan-checklist
  // ticks) with no Work Completed entry dated that day (Mitchell 2026-08-18).
  const yesterday = brisbaneDateISO(new Date(nowMs - DAY_MS));
  const yStart = new Date(`${yesterday}T00:00:00+10:00`).toISOString();
  const yEnd = new Date(`${today}T00:00:00+10:00`).toISOString();
  const workedY = new Map<string, Set<string>>();
  const touchY = (jobId: string | null, staffId: string | null) => {
    if (!jobId) return;
    if (!workedY.has(jobId)) workedY.set(jobId, new Set());
    if (staffId) workedY.get(jobId)!.add(staffId);
  };
  const { data: yTime } = await svc
    .from("job_time")
    .select("job_id, staff_id")
    .gte("start_time", yStart)
    .lt("start_time", yEnd);
  for (const r of yTime ?? []) touchY(r.job_id, r.staff_id);
  const { data: yTicks } = await svc
    .from("plan_items")
    .select("job_id, installed_by, installed_at, roughed_in_by, roughed_in_at")
    .not("job_id", "is", null)
    .or(`and(installed_at.gte.${yStart},installed_at.lt.${yEnd}),and(roughed_in_at.gte.${yStart},roughed_in_at.lt.${yEnd})`);
  for (const r of yTicks ?? []) {
    if (r.installed_at && r.installed_at >= yStart && r.installed_at < yEnd) touchY(r.job_id, r.installed_by);
    if (r.roughed_in_at && r.roughed_in_at >= yStart && r.roughed_in_at < yEnd) touchY(r.job_id, r.roughed_in_by);
  }
  let unfilledWriteups: Array<{ number: string; where: string; techs: string; href: string }> = [];
  const yJobIds = [...workedY.keys()];
  if (yJobIds.length > 0) {
    const { data: yEntries } = await svc
      .from("job_work_entries")
      .select("job_id")
      .in("job_id", yJobIds)
      .eq("work_date", yesterday);
    const yCovered = new Set((yEntries ?? []).map((e) => e.job_id));
    const yMissing = yJobIds.filter((id) => !yCovered.has(id));
    if (yMissing.length > 0) {
      const [{ data: yJobs }, { data: staffRows }] = await Promise.all([
        svc.from("jobs").select("id, number, customer:customers(name), site:customer_sites(name)").in("id", yMissing),
        svc.from("staff").select("id, initials"),
      ]);
      const initialsById = new Map((staffRows ?? []).map((s) => [s.id, s.initials]));
      unfilledWriteups = (yJobs ?? []).map((j: any) => ({
        number: j.number ?? "—",
        where: nameOf(j.site) || nameOf(j.customer) || "—",
        techs: [...(workedY.get(j.id) ?? [])].map((id) => initialsById.get(id) ?? "?").join(", "),
        href: `/jobs/${j.id}`,
      }));
    }
  }

  const hasContent =
    tasks.length > 0 || overdueRows.length > 0 || unsentRows.length > 0 || planRows.length > 0 ||
    unfilledWriteups.length > 0 ||
    !!(emailTriage && (emailTriage.billsForwarded || emailTriage.flagged || emailTriage.errors));
  if (!hasContent) {
    // Silence IS the all-clear (D3).
    return NextResponse.json({ ok: true, sent: false, reason: "nothing actionable" });
  }

  const dateLabel = new Date().toLocaleDateString("en-AU", {
    timeZone: "Australia/Brisbane",
    weekday: "long",
    day: "numeric",
    month: "long",
  });

  const result = await sendMorningDigestEmail({
    to: OWNER_EMAIL,
    dateLabel,
    tasks,
    overdueInvoices: { count: overdueRows.length, total: overdueTotal, top },
    unsentInvoices: { count: unsentRows.length, total: unsentTotal },
    pendingMandates: { count: planRows.length, monthlyValue: mandateMonthly, oldestDays: oldestMandateDays },
    unfilledWriteups,
    emailTriage,
    appBaseUrl,
  });
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 502 });
  }

  return NextResponse.json({
    ok: true,
    sent: true,
    tasks: tasks.length,
    overdue: overdueRows.length,
    unsent: unsentRows.length,
    pendingMandates: planRows.length,
    unfilledWriteups: unfilledWriteups.length,
  });
}
