import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { getAuthedClient } from "@/lib/xero/client";
import { fetchXeroInvoice, fetchXeroOnlineInvoiceUrl } from "@/lib/xero/invoices";
import { isXeroRateLimited, captureXeroRateLimit } from "@/lib/xero/rate-limit";
import { sendInvoiceReminderEmail } from "@/lib/emails/invoice-reminder";
import { logDocumentActivity } from "@/lib/activity/log";
import { enqueueNotification } from "@/lib/notifications/enqueue";

/**
 * Send a payment reminder to the customer for an outstanding invoice.
 *
 * Memory rule (2026-05-11 incident): never send to customers in Xero/Xero-flow
 * without confirmation. This route requires an explicit { email } payload from
 * the UI confirmation modal — no bulk fire-and-forget caller is allowed to hit
 * it without that gate.
 *
 * Safeguard: before sending, this route re-fetches the invoice from Xero. If
 * Xero says it's paid/voided we sync the CRM row and refuse to send — that's
 * the "if recurring invoices haven't been reconciled yet we'd piss the
 * customer off" case Mitchell flagged when designing this.
 */
export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const body = await req.json().catch(() => ({}));
  const email = (body?.email ?? "").trim();
  const trigger = (body?.trigger ?? "manual") as "manual" | "auto";
  if (!email) {
    return NextResponse.json({ error: "Recipient email required" }, { status: 400 });
  }

  const supabase = await createClient();

  const { data: invoice, error } = await supabase
    .from("invoices")
    .select(`
      id, xero_invoice_id, xero_invoice_number, xero_online_url,
      status, total, amount_due, due_date, reminder_count, auto_remind_enabled,
      customer:customers(id, name, customer_contacts(name, email, is_primary))
    `)
    .eq("id", id)
    .single();
  if (error || !invoice) {
    return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
  }
  if (!invoice.xero_invoice_id) {
    return NextResponse.json(
      { error: "Invoice is not linked to Xero — cannot verify status before reminding." },
      { status: 400 },
    );
  }

  // Safeguard: re-pull Xero state right before sending so we never remind on
  // an invoice that's been paid in Xero but not yet synced to the CRM.
  const limited = await isXeroRateLimited(supabase);
  if (limited) {
    return NextResponse.json(
      { error: "Xero rate-limited. Cannot verify invoice status — try again later." },
      { status: 429 },
    );
  }

  let latest;
  let payUrl: string | null = invoice.xero_online_url ?? null;
  try {
    const { client, conn } = await getAuthedClient();
    latest = await fetchXeroInvoice(client, conn.tenant_id, invoice.xero_invoice_id);
    // Synced-from-Xero invoices never got a pay link stored (only the CRM's
    // authorise flow writes it) — fetch and backfill so the reminder always
    // carries a "View & Pay" button. Best-effort: a miss just means the email
    // falls back to bank-details copy, as before.
    if (!payUrl) {
      try {
        payUrl = await fetchXeroOnlineInvoiceUrl(client, conn.tenant_id, invoice.xero_invoice_id);
      } catch (err) {
        console.error(`[send-reminder] couldn't fetch online invoice URL for ${id}:`, err);
      }
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    await captureXeroRateLimit(supabase, err);
    return NextResponse.json(
      { error: `Could not verify invoice status with Xero: ${message}` },
      { status: 502 },
    );
  }

  const xStatus = latest.status.toLowerCase();
  const normalisedStatus =
    xStatus === "paid" ? "paid"
    : xStatus === "voided" ? "void"
    : xStatus === "draft" ? "draft"
    : "authorised";

  // Sync the local row with Xero's truth — regardless of whether we end up
  // sending. Keeps the CRM honest.
  await supabase
    .from("invoices")
    .update({
      ...(payUrl && !invoice.xero_online_url ? { xero_online_url: payUrl } : {}),
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
    .eq("id", id);

  if (normalisedStatus !== "authorised" || latest.amountDue <= 0) {
    return NextResponse.json(
      {
        error: `Reminder not sent — Xero reports this invoice as "${normalisedStatus}" with $${latest.amountDue.toFixed(2)} due. CRM has been refreshed.`,
        synced: true,
        status: normalisedStatus,
        amountDue: latest.amountDue,
      },
      { status: 409 },
    );
  }

  // Resolve contact name for greeting.
  type CustomerWithContacts = {
    id: string;
    name: string;
    customer_contacts: { name: string | null; email: string | null; is_primary: boolean | null }[];
  };
  const customer: CustomerWithContacts | null = Array.isArray(invoice.customer)
    ? ((invoice.customer[0] as CustomerWithContacts | undefined) ?? null)
    : (invoice.customer as CustomerWithContacts | null);
  const contacts = customer?.customer_contacts ?? [];
  const matchedContact =
    contacts.find((c) => c.email && c.email.toLowerCase() === email.toLowerCase()) ??
    contacts.find((c) => c.is_primary) ??
    contacts[0] ??
    null;
  const firstName = matchedContact?.name?.trim().split(/\s+/)[0] ?? null;

  const daysOverdue = invoice.due_date
    ? Math.max(0, Math.floor((Date.now() - new Date(invoice.due_date).getTime()) / 86_400_000))
    : 0;

  const ref = invoice.xero_invoice_number ?? invoice.id.slice(0, 8);
  const reminderNumber = (invoice.reminder_count ?? 0) + 1;

  const result = await sendInvoiceReminderEmail({
    to: email,
    invoiceRef: ref,
    customerName: customer?.name ?? "—",
    contactFirstName: firstName,
    amountDue: latest.amountDue,
    dueDate: invoice.due_date,
    daysOverdue,
    payUrl,
    invoiceId: invoice.id,
    reminderNumber,
  });

  // The invoice_reminders audit table is admin-only on INSERT under RLS, but
  // any staffer with invoices.send can legitimately reach this route. Write
  // the audit row via the service-role client so a non-admin's reminder is
  // never silently dropped from the history (audit 2026-06-01 HIGH).
  const svc = createServiceRoleClient();

  if (!result.ok) {
    // Log the failed attempt — useful for debugging Resend issues.
    const { error: logErr } = await svc.from("invoice_reminders").insert({
      invoice_id: invoice.id,
      recipient_email: email,
      trigger,
      amount_due_at_send: latest.amountDue,
      days_overdue: daysOverdue,
      error: result.error,
    });
    if (logErr) console.error("[send-reminder] failed-attempt audit insert error:", logErr);
    return NextResponse.json({ error: result.error }, { status: 502 });
  }

  const nowIso = new Date().toISOString();
  const { error: auditErr } = await svc.from("invoice_reminders").insert({
    invoice_id: invoice.id,
    recipient_email: email,
    trigger,
    amount_due_at_send: latest.amountDue,
    days_overdue: daysOverdue,
    resend_message_id: result.messageId,
  });
  if (auditErr) console.error("[send-reminder] audit insert error:", auditErr);

  await supabase
    .from("invoices")
    .update({
      last_reminder_sent_at: nowIso,
      reminder_count: reminderNumber,
    })
    .eq("id", id);

  await logDocumentActivity({
    supabase,
    documentType: "invoice",
    documentId: id,
    eventType: "invoice.reminder.sent",
    metadata: { to: email, ref, reminderNumber, daysOverdue, amountDue: latest.amountDue, trigger },
  });

  await enqueueNotification({
    supabase,
    typeCode: "invoice.reminder.sent",
    refType: "invoice",
    refId: id,
    audience: { allActive: true },
    title: `Reminder sent — ${ref}`,
    body: `${customer?.name ?? ""} · $${latest.amountDue.toFixed(2)} due${daysOverdue > 0 ? ` (${daysOverdue}d overdue)` : ""}`,
    href: `/invoices/${id}`,
  });

  return NextResponse.json({ ok: true, reminderNumber, daysOverdue, amountDue: latest.amountDue });
}
