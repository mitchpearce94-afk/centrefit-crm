import "server-only";
import { Resend } from "resend";
import { emailHeader, emailFooter, emailLayout } from "@/lib/emails/brand";
import { FROM_INVOICES, REPLY_TO_ACCOUNTS } from "@/lib/emails/from-addresses";

function getResend() {
  return new Resend(process.env.RESEND_API_KEY);
}

export interface SendInvoiceReminderInput {
  /** Single recipient, or comma-separated list — both forms accepted. */
  to: string | string[];
  invoiceRef: string;
  customerName: string;
  contactFirstName?: string | null;
  amountDue: number;
  dueDate: string | null;
  daysOverdue: number;
  payUrl: string | null;
  invoiceId: string;
  reminderNumber: number;
  /**
   * friendly = the first four nudges; firm = 14 days overdue ("payment
   * required within 7 days"); final = 28 days overdue (final notice).
   * Polite, short, sharp — Mitchell's voice, never threatening.
   */
  tone?: "friendly" | "firm" | "final";
}

function fmt(n: number): string {
  return n.toLocaleString("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-AU", {
    timeZone: "Australia/Brisbane",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

export async function sendInvoiceReminderEmail(
  input: SendInvoiceReminderInput,
): Promise<{ ok: true; messageId: string | null } | { ok: false; error: string }> {
  const greeting = input.contactFirstName ? `Hi ${input.contactFirstName},` : "Hi,";
  const amountStr = `$${fmt(input.amountDue)}`;
  const dueStr = formatDate(input.dueDate);

  // Same template serves the pre-due "due soon" nudge and the overdue chase —
  // tense and headline switch on where the due date sits relative to now.
  const dueInFuture = input.dueDate ? new Date(input.dueDate).getTime() > Date.now() : false;
  const tone = input.tone ?? "friendly";
  const overdueStr = `${input.daysOverdue} day${input.daysOverdue === 1 ? "" : "s"} overdue`;
  const headline =
    tone === "final"
      ? `Final notice — invoice ${input.invoiceRef} is ${overdueStr}`
      : tone === "firm"
        ? `Invoice ${input.invoiceRef} is ${overdueStr} — payment required`
        : input.daysOverdue > 0
          ? `Invoice ${input.invoiceRef} is ${overdueStr}`
          : dueInFuture
            ? `Invoice ${input.invoiceRef} is due soon`
            : `Invoice ${input.invoiceRef} — payment reminder`;
  const body =
    tone === "final"
      ? `Invoice <strong>${input.invoiceRef}</strong> for <strong>${amountStr}</strong>${input.dueDate ? ` was due on <strong>${dueStr}</strong> and` : ""} is now ${overdueStr}, despite our earlier reminders. Please arrange payment within 7 days, or reply to this email so we can agree a date. Accounts still unpaid after that may have services placed on hold until the balance is cleared.`
      : tone === "firm"
        ? `Invoice <strong>${input.invoiceRef}</strong> for <strong>${amountStr}</strong>${input.dueDate ? ` was due on <strong>${dueStr}</strong> and` : ""} is now ${overdueStr}. Please arrange payment within 7 days, or reply to let us know when we can expect it.`
        : `This is a friendly reminder that <strong>${amountStr}</strong> remains outstanding on invoice <strong>${input.invoiceRef}</strong>${input.dueDate ? `, which ${dueInFuture ? "is due" : "was due"} <strong>${dueStr}</strong>` : ""}.`;
  const subject =
    tone === "final"
      ? `Final notice: ${input.invoiceRef} — ${input.customerName}`
      : tone === "firm"
        ? `Overdue: ${input.invoiceRef} — ${input.customerName}`
        : `Reminder: ${input.invoiceRef} — ${input.customerName}`;

  const payButton = input.payUrl
    ? `
      <tr><td align="center" style="padding:28px 32px 8px;text-align:center">
        <a href="${input.payUrl}" style="display:inline-block;background:#3b82f6;color:#ffffff;text-align:center;padding:14px 28px;border-radius:10px;font-size:14px;font-weight:700;text-decoration:none;letter-spacing:0.3px">
          View &amp; Pay Invoice
        </a>
        <p style="font-size:11px;color:#94a3b8;margin:14px 0 0;text-align:center;line-height:1.5">
          Secure online payment via Xero.
        </p>
      </td></tr>`
    : "";

  const html = emailLayout(`
    ${emailHeader({ rightLabel: tone === "final" ? "Final notice" : tone === "firm" ? "Overdue" : "Reminder", rightValue: input.invoiceRef })}

    <tr><td style="padding:32px 32px 12px">
      <h1 style="font-size:20px;font-weight:600;color:#0f172a;margin:0 0 4px;letter-spacing:-0.3px">${headline}</h1>
      <p style="font-size:13px;color:#475569;margin:14px 0 0;line-height:1.6">${greeting}</p>
      <p style="font-size:13px;color:#475569;margin:10px 0 0;line-height:1.6">
        ${body}
      </p>
      <p style="font-size:13px;color:#475569;margin:10px 0 0;line-height:1.6">
        <em>If you&rsquo;ve already paid this invoice in the last few business days, please disregard this reminder — our records may not have caught up yet.</em>
      </p>
      <p style="font-size:13px;color:#475569;margin:10px 0 0;line-height:1.6">
        ${input.payUrl ? "You can pay online via the link below or transfer to the bank details on the original invoice." : "Please refer to the bank details on the original invoice to make payment."}
      </p>
    </td></tr>
    ${payButton}
    ${emailFooter("Reply to this email if you have any questions about your account.")}
  `);

  try {
    const { data, error } = await getResend().emails.send({
      from: FROM_INVOICES,
      replyTo: REPLY_TO_ACCOUNTS,
      to: (Array.isArray(input.to) ? input.to : input.to.split(","))
        .map((e) => e.trim())
        .filter((e) => e.length > 0),
      subject,
      html,
      headers: {
        "X-Cf-Doc-Type": "invoice-reminder",
        "X-Cf-Doc-Id": input.invoiceId,
        "X-Cf-Reminder-Number": String(input.reminderNumber),
      },
    });
    if (error) return { ok: false, error: error.message };
    return { ok: true, messageId: data?.id ?? null };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
