import "server-only";
import { Resend } from "resend";
import { emailHeader, emailFooter, emailLayout } from "@/lib/emails/brand";
import { FROM_INVOICES, REPLY_TO_ACCOUNTS } from "@/lib/emails/from-addresses";

function getResend() {
  return new Resend(process.env.RESEND_API_KEY);
}

export interface SendInvoiceReminderInput {
  to: string;
  invoiceRef: string;
  customerName: string;
  contactFirstName?: string | null;
  amountDue: number;
  dueDate: string | null;
  daysOverdue: number;
  payUrl: string | null;
  invoiceId: string;
  reminderNumber: number;
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

  const headline =
    input.daysOverdue > 0
      ? `Invoice ${input.invoiceRef} is ${input.daysOverdue} day${input.daysOverdue === 1 ? "" : "s"} overdue`
      : `Invoice ${input.invoiceRef} — payment reminder`;

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
    ${emailHeader({ rightLabel: "Reminder", rightValue: input.invoiceRef })}

    <tr><td style="padding:32px 32px 12px">
      <h1 style="font-size:20px;font-weight:600;color:#0f172a;margin:0 0 4px;letter-spacing:-0.3px">${headline}</h1>
      <p style="font-size:13px;color:#475569;margin:14px 0 0;line-height:1.6">${greeting}</p>
      <p style="font-size:13px;color:#475569;margin:10px 0 0;line-height:1.6">
        This is a friendly reminder that <strong>${amountStr}</strong> remains outstanding on invoice <strong>${input.invoiceRef}</strong>${input.dueDate ? `, which was due <strong>${dueStr}</strong>` : ""}.
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
      to: input.to,
      subject: `Reminder: ${input.invoiceRef} — ${input.customerName}`,
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
