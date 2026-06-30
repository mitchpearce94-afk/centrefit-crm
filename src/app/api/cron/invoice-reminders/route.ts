import { NextRequest, NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { getAuthedClient } from "@/lib/xero/client";
import { fetchXeroInvoice } from "@/lib/xero/invoices";
import { isXeroRateLimited, captureXeroRateLimit } from "@/lib/xero/rate-limit";
import { sendInvoiceReminderEmail } from "@/lib/emails/invoice-reminder";
import { logDocumentActivity } from "@/lib/activity/log";
import { enqueueNotification } from "@/lib/notifications/enqueue";

/**
 * Daily cron (weekday mornings AEST) — automatic invoice reminders.
 * Requested by Mitchell 2026-06-10 ("auto reminders and overdue reminders
 * as well"), which is the explicit confirmation the manual send-reminder
 * route's no-bulk-sends rule requires.
 *
 * Four fixed milestones relative to the due date, each sent once and audited
 * separately in invoice_reminders.trigger (Mitchell's 2026-06-30 cadence):
 *   - auto_due_3:     3 days before due
 *   - auto_due:       on the due day
 *   - auto_overdue_3: 3 days after due
 *   - auto_overdue_7: 7 days after due
 * The cron only runs weekday mornings, so each run sends the LATEST milestone
 * an invoice has reached but not yet been sent — a milestone whose exact day
 * landed on a weekend/holiday is caught up on the next run, never skipped.
 * After the +7 milestone there are no further auto reminders (manual chase
 * only), so the old "every 7 days, max 3" repeat is retired.
 *
 * Hard safety rails (the 2026-05-11 incident class):
 *   - Only invoices we actually emailed to the customer (sent_at set), and
 *     never within 2 days of that send — they just received the invoice.
 *   - auto_remind_enabled must be on (per-invoice kill switch in the UI).
 *   - Every send re-verifies the invoice against Xero first and syncs the
 *     local row; paid/voided invoices are skipped, never reminded.
 *   - Batch capped at 15 sends per run; Xero rate-limit aborts the run.
 *
 * Auth: X-Cf-Cron-Secret must match CRON_SECRET (same as quote-followups).
 */

// Fixed milestones (calendar days relative to the due date), newest-reached
// first. Each fires at most once, tracked by its distinct trigger value.
const MILESTONES = [
  { offset: 7, trigger: "auto_overdue_7" },
  { offset: 3, trigger: "auto_overdue_3" },
  { offset: 0, trigger: "auto_due" },
  { offset: -3, trigger: "auto_due_3" },
] as const;
type ReminderTrigger = (typeof MILESTONES)[number]["trigger"];

const EARLIEST_OFFSET = -3;     // first milestone: 3 days before due
const MIN_GAP_DAYS = 2;         // never stack a reminder within 2 days of any prior one (incl. manual)
const SENT_COOLOFF_DAYS = 2;    // never remind within 2 days of sending the invoice
const BATCH_CAP = 15;

const DAY_MS = 86_400_000;
// Brisbane is UTC+10 year-round (no DST). The cron fires at 23:00 UTC = 09:00
// AEST, so the UTC calendar date lags Brisbane by a day at run time — compute
// the civil "today" in Brisbane so the milestone day-maths lands on the right
// day (notably the due-day reminder).
const BRISBANE_OFFSET_MS = 10 * 60 * 60 * 1000;

function reminderLabel(kind: ReminderTrigger): string {
  switch (kind) {
    case "auto_due_3": return "Due-soon reminder";
    case "auto_due": return "Due-today reminder";
    case "auto_overdue_3": return "Overdue reminder";
    case "auto_overdue_7": return "Final overdue reminder";
  }
}

interface CandidateInvoice {
  id: string;
  xero_invoice_id: string | null;
  xero_invoice_number: string | null;
  xero_online_url: string | null;
  invoice_type: string;
  status: string;
  amount_due: number;
  due_date: string | null;
  sent_at: string | null;
  sent_to_email: string | null;
  reminder_count: number | null;
  last_reminder_sent_at: string | null;
  site: { billing_email: string | null } | { billing_email: string | null }[] | null;
  customer: CustomerWithContacts | CustomerWithContacts[] | null;
}

interface CustomerWithContacts {
  id: string;
  name: string;
  customer_contacts: { name: string | null; email: string | null; is_primary: boolean | null }[];
}

function one<T>(value: T | T[] | null): T | null {
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const provided = req.headers.get("x-cf-cron-secret") ?? req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!secret) {
    return NextResponse.json({ error: "CRON_SECRET not configured" }, { status: 500 });
  }
  if (provided !== secret) {
    return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  }

  const svc = createServiceRoleClient();
  const now = Date.now();
  const today = new Date(now + BRISBANE_OFFSET_MS).toISOString().slice(0, 10);
  const todayMs = Date.parse(`${today}T00:00:00Z`);
  // Widest net: anything due on/after the earliest milestone (due − 3) through
  // everything already overdue. (today − EARLIEST_OFFSET = today + 3.)
  const dueHorizon = new Date(todayMs - EARLIEST_OFFSET * DAY_MS).toISOString().slice(0, 10);
  const sentCooloff = new Date(now - SENT_COOLOFF_DAYS * DAY_MS).toISOString();

  const { data: candidates, error } = await svc
    .from("invoices")
    .select(`
      id, xero_invoice_id, xero_invoice_number, xero_online_url, invoice_type,
      status, amount_due, due_date, sent_at, sent_to_email,
      reminder_count, last_reminder_sent_at,
      site:customer_sites(billing_email),
      customer:customers(id, name, customer_contacts(name, email, is_primary))
    `)
    .eq("status", "authorised")
    .eq("auto_remind_enabled", true)
    .neq("invoice_type", "recurring")
    .gt("amount_due", 0)
    .not("sent_at", "is", null)
    .not("due_date", "is", null)
    .not("xero_invoice_id", "is", null)
    .lte("sent_at", sentCooloff)
    .lte("due_date", dueHorizon)
    .order("due_date", { ascending: true })
    .limit(200);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Which milestones each invoice has already been sent, so each fires once.
  // Keyed `${invoice_id}:${trigger}`; errored sends are excluded so a failed
  // attempt is retried next run.
  const ids = (candidates ?? []).map((c) => c.id);
  const { data: history } = ids.length
    ? await svc
        .from("invoice_reminders")
        .select("invoice_id, trigger, error")
        .in("invoice_id", ids)
        .is("error", null)
    : { data: [] as { invoice_id: string; trigger: string }[] };
  const sentMilestones = new Set(
    (history ?? []).map((h) => `${h.invoice_id}:${h.trigger}`),
  );

  type Planned = { invoice: CandidateInvoice; kind: ReminderTrigger; daysOverdue: number };
  const planned: Planned[] = [];
  for (const raw of (candidates ?? []) as CandidateInvoice[]) {
    const dueMs = Date.parse(`${raw.due_date}T00:00:00Z`);
    const dRel = Math.round((todayMs - dueMs) / DAY_MS); // +ve = days past due

    // Latest milestone this invoice has reached (MILESTONES is newest-first).
    const milestone = MILESTONES.find((m) => dRel >= m.offset);
    if (!milestone) continue; // earlier than 3 days before due — nothing yet
    if (sentMilestones.has(`${raw.id}:${milestone.trigger}`)) continue; // already sent

    // Never stack on a recent reminder — a manual chase, or a milestone we
    // just caught up — so two reminders can't land within MIN_GAP_DAYS.
    const last = raw.last_reminder_sent_at ? new Date(raw.last_reminder_sent_at).getTime() : null;
    if (last !== null && now - last < MIN_GAP_DAYS * DAY_MS) continue;

    planned.push({ invoice: raw, kind: milestone.trigger, daysOverdue: Math.max(0, dRel) });
    if (planned.length >= BATCH_CAP) break;
  }

  const results: Array<{ id: string; ref: string; kind: string; ok: boolean; skipped?: string; error?: string }> = [];

  for (const { invoice, kind, daysOverdue } of planned) {
    const ref = invoice.xero_invoice_number ?? invoice.id.slice(0, 8);

    // Recipient: where we sent the invoice → site billing email → primary
    // contact → first contact. No address means no send, never a guess.
    const customer = one(invoice.customer);
    const contacts = customer?.customer_contacts ?? [];
    const email =
      invoice.sent_to_email?.trim() ||
      one(invoice.site)?.billing_email?.trim() ||
      contacts.find((c) => c.is_primary)?.email ||
      contacts[0]?.email ||
      null;
    if (!email) {
      results.push({ id: invoice.id, ref, kind, ok: false, skipped: "no recipient email" });
      continue;
    }

    // Re-verify against Xero immediately before sending — abort the whole
    // run if rate-limited rather than sending unverified reminders.
    if (await isXeroRateLimited(svc)) {
      results.push({ id: invoice.id, ref, kind, ok: false, skipped: "xero rate-limited, run aborted" });
      break;
    }
    let latest;
    try {
      const { client, conn } = await getAuthedClient();
      latest = await fetchXeroInvoice(client, conn.tenant_id, invoice.xero_invoice_id!);
    } catch (err) {
      await captureXeroRateLimit(svc, err);
      results.push({ id: invoice.id, ref, kind, ok: false, error: `xero verify failed: ${err instanceof Error ? err.message : String(err)}` });
      continue;
    }

    const xStatus = latest.status.toLowerCase();
    const normalisedStatus =
      xStatus === "paid" ? "paid"
      : xStatus === "voided" ? "void"
      : xStatus === "draft" ? "draft"
      : "authorised";
    await svc
      .from("invoices")
      .update({
        amount_due: latest.amountDue,
        amount_paid: latest.amountPaid,
        status: normalisedStatus,
        paid_at:
          normalisedStatus === "paid"
            ? latest.fullyPaidOnDate
              ? new Date(latest.fullyPaidOnDate).toISOString()
              : new Date().toISOString()
            : null,
        xero_last_synced_at: new Date().toISOString(),
        xero_last_error: null,
      })
      .eq("id", invoice.id);
    if (normalisedStatus !== "authorised" || latest.amountDue <= 0) {
      results.push({ id: invoice.id, ref, kind, ok: false, skipped: `xero says ${normalisedStatus}, $${latest.amountDue.toFixed(2)} due — synced, not reminded` });
      continue;
    }

    const matchedContact =
      contacts.find((c) => c.email && c.email.toLowerCase() === email.toLowerCase()) ??
      contacts.find((c) => c.is_primary) ??
      contacts[0] ??
      null;
    const reminderNumber = (invoice.reminder_count ?? 0) + 1;

    const sendResult = await sendInvoiceReminderEmail({
      to: email,
      invoiceRef: ref,
      customerName: customer?.name ?? "—",
      contactFirstName: matchedContact?.name?.trim().split(/\s+/)[0] ?? null,
      amountDue: latest.amountDue,
      dueDate: invoice.due_date,
      daysOverdue,
      payUrl: invoice.xero_online_url,
      invoiceId: invoice.id,
      reminderNumber,
    });

    const { error: auditErr } = await svc.from("invoice_reminders").insert({
      invoice_id: invoice.id,
      recipient_email: email,
      trigger: kind,
      amount_due_at_send: latest.amountDue,
      days_overdue: daysOverdue,
      resend_message_id: sendResult.ok ? sendResult.messageId : null,
      error: sendResult.ok ? null : sendResult.error,
    });
    if (auditErr) console.error("[invoice-reminders] audit insert error:", auditErr);

    if (!sendResult.ok) {
      results.push({ id: invoice.id, ref, kind, ok: false, error: sendResult.error });
      continue;
    }

    await svc
      .from("invoices")
      .update({ last_reminder_sent_at: new Date().toISOString(), reminder_count: reminderNumber })
      .eq("id", invoice.id);

    await logDocumentActivity({
      supabase: svc,
      documentType: "invoice",
      documentId: invoice.id,
      eventType: "invoice.reminder.sent",
      metadata: { to: email, ref, reminderNumber, daysOverdue, amountDue: latest.amountDue, trigger: kind },
    });

    await enqueueNotification({
      typeCode: "invoice.reminder.sent",
      refType: "invoice",
      refId: invoice.id,
      audience: { allActive: true },
      title: `${reminderLabel(kind)} sent — ${ref}`,
      body: `${customer?.name ?? ""} · $${latest.amountDue.toFixed(2)} due${daysOverdue > 0 ? ` (${daysOverdue}d overdue)` : ""}`,
      href: `/invoices/${invoice.id}`,
    });

    results.push({ id: invoice.id, ref, kind, ok: true });
  }

  return NextResponse.json({
    checked: candidates?.length ?? 0,
    planned: planned.length,
    sent: results.filter((r) => r.ok).length,
    results,
  });
}
