import "server-only";
import { Resend } from "resend";
import { emailHeader, emailFooter, emailLayout } from "@/lib/emails/brand";

const FROM_ADDRESS = "Centrefit Accounts <accounts@centrefit.com.au>";
const REPLY_TO = "accounts@centrefit.com.au";

function getResend() {
  return new Resend(process.env.RESEND_API_KEY);
}

export interface SendDDRecurringInvoiceInput {
  to: string;
  customerName: string;
  /** Display label for the site/facility this invoice covers. */
  siteLabel: string;
  /** "INV-XXXX" or null if Xero hasn't assigned yet (rare). */
  invoiceNumber: string | null;
  /** GST-inclusive total. */
  total: number;
  /** ISO date when GC will pull funds (typically same as Xero due_date). */
  debitDate: string | null;
  /** Online invoice URL from Xero (read-only public view). */
  xeroOnlineUrl: string | null;
  /** Plain text describing what's being billed (e.g. "NBN Plan 100/40"). */
  serviceSummary: string;
}

/**
 * Email a customer when one of our Xero RepeatingInvoice templates auto-
 * generated a child invoice for them. The copy explicitly tells them direct
 * debit will pull the amount automatically — they shouldn't try to pay it
 * manually thinking the invoice is overdue.
 */
export async function sendDDRecurringInvoiceEmail(input: SendDDRecurringInvoiceInput) {
  const subject = `${input.siteLabel} — your ${input.invoiceNumber ?? "invoice"} is ready`;

  const debitLine = input.debitDate
    ? `Direct debit will pull <strong>$${input.total.toFixed(2)}</strong> from your bank account on <strong>${formatAUDate(input.debitDate)}</strong>.`
    : `Direct debit will pull <strong>$${input.total.toFixed(2)}</strong> automatically when the invoice falls due.`;

  const body = `
    ${emailHeader({ rightLabel: "Recurring", rightValue: input.invoiceNumber ?? "—" })}

    <p style="font-size:14px;line-height:1.6;color:#111827;margin:0 0 14px">
      Hi ${escape(input.customerName)},
    </p>

    <p style="font-size:14px;line-height:1.6;color:#111827;margin:0 0 14px">
      Your latest invoice for <strong>${escape(input.siteLabel)}</strong> has been issued.
    </p>

    <div style="border-left:3px solid #10b981;background:#ecfdf5;padding:12px 14px;margin:0 0 18px;border-radius:0 6px 6px 0">
      <p style="margin:0 0 4px;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;color:#065f46">
        For your records — no action needed
      </p>
      <p style="margin:0;font-size:13px;line-height:1.55;color:#065f46">
        ${debitLine} You don't need to pay this invoice manually — it'll be deducted automatically via your direct debit mandate.
      </p>
    </div>

    <div style="border:1px solid #e5e7eb;border-radius:8px;padding:16px;margin:0 0 18px;background:#fafafa">
      <table style="width:100%;border-collapse:collapse;font-size:13px">
        <tr><td style="padding:4px 0;color:#6b7280">Invoice number</td><td style="padding:4px 0;text-align:right;font-family:Consolas,Menlo,monospace">${escape(input.invoiceNumber ?? "—")}</td></tr>
        <tr><td style="padding:4px 0;color:#6b7280">Site</td><td style="padding:4px 0;text-align:right">${escape(input.siteLabel)}</td></tr>
        <tr><td style="padding:4px 0;color:#6b7280">Services</td><td style="padding:4px 0;text-align:right">${escape(input.serviceSummary)}</td></tr>
        <tr><td style="padding:4px 0;color:#6b7280">Debit date</td><td style="padding:4px 0;text-align:right">${input.debitDate ? formatAUDate(input.debitDate) : "—"}</td></tr>
        <tr><td style="padding:8px 0 0;color:#111827;font-weight:600;border-top:1px solid #e5e7eb">Total (incl. GST)</td><td style="padding:8px 0 0;text-align:right;font-weight:600;font-family:Consolas,Menlo,monospace;border-top:1px solid #e5e7eb">$${input.total.toFixed(2)}</td></tr>
      </table>
    </div>

    ${input.xeroOnlineUrl ? `
    <p style="text-align:center;margin:0 0 18px">
      <a href="${input.xeroOnlineUrl}" style="display:inline-block;background:#111827;color:#ffffff;padding:10px 20px;border-radius:6px;font-size:13px;font-weight:600;text-decoration:none">
        View invoice
      </a>
    </p>
    ` : ""}

    <p style="font-size:12px;line-height:1.55;color:#6b7280;margin:18px 0 0">
      Need to update bank details, pause, or cancel? Just reply to this email and we'll sort it.
    </p>

    ${emailFooter()}
  `;

  await getResend().emails.send({
    from: FROM_ADDRESS,
    to: [input.to],
    replyTo: REPLY_TO,
    subject,
    html: emailLayout(body),
  });
}

function formatAUDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-AU", {
    day: "numeric", month: "short", year: "numeric",
  });
}

function escape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
