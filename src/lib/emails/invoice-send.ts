import "server-only";
import { Resend } from "resend";
import { emailHeader, emailFooter, emailLayout } from "@/lib/emails/brand";
import { FROM_INVOICES, REPLY_TO_ACCOUNTS } from "@/lib/emails/from-addresses";

function getResend() {
  return new Resend(process.env.RESEND_API_KEY);
}

export interface SendInvoiceEmailInput {
  to: string;
  invoiceRef: string;          // local invoice ref (e.g. "INV-CF-2026-0123") or Xero number
  customerName: string;
  contactFirstName?: string | null;
  total: number;
  dueDate: string | null;       // ISO date or null
  invoiceType: "full" | "progress_pp1" | "progress_pp2" | "recurring" | string;
  /** URL to view + pay the invoice — usually the Xero OnlineInvoiceUrl. */
  payUrl: string | null;
  invoiceId: string;
  pdfBuffer?: Buffer | null;
}

function fmt(n: number): string {
  return n.toLocaleString("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatDueDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-AU", {
    timeZone: "Australia/Brisbane",
    day: "numeric", month: "long", year: "numeric",
  });
}

export async function sendInvoiceEmail(input: SendInvoiceEmailInput): Promise<{ ok: true } | { ok: false; error: string }> {
  const greeting = input.contactFirstName ? `Hi ${input.contactFirstName},` : "Hi,";
  const totalStr = `$${fmt(input.total)}`;
  const dueStr = formatDueDate(input.dueDate);
  const typeLabel =
    input.invoiceType === "progress_pp1" ? "Progress Payment 1" :
    input.invoiceType === "progress_pp2" ? "Progress Payment 2" :
    input.invoiceType === "recurring" ? "Recurring billing invoice" :
    "Invoice";

  const payButton = input.payUrl
    ? `
      <tr><td align="center" style="padding:28px 32px 8px;text-align:center">
        <a href="${input.payUrl}" style="display:inline-block;background:#3b82f6;color:#ffffff;text-align:center;padding:14px 28px;border-radius:10px;font-size:14px;font-weight:700;text-decoration:none;letter-spacing:0.3px">
          View &amp; Pay Invoice
        </a>
        <p style="font-size:11px;color:#94a3b8;margin:14px 0 0;text-align:center;line-height:1.5">
          Secure online payment via Xero. The PDF is also attached for your records.
        </p>
      </td></tr>`
    : "";

  const html = emailLayout(`
    ${emailHeader({ rightLabel: "Invoice", rightValue: input.invoiceRef })}

    <tr><td style="padding:32px 32px 12px">
      <h1 style="font-size:20px;font-weight:600;color:#0f172a;margin:0 0 4px;letter-spacing:-0.3px">${typeLabel} from Centrefit</h1>
      <p style="font-size:13px;color:#475569;margin:14px 0 0;line-height:1.6">${greeting}</p>
      <p style="font-size:13px;color:#475569;margin:10px 0 0;line-height:1.6">
        Please find your invoice attached. Total: <strong>${totalStr}</strong>${input.dueDate ? `, due <strong>${dueStr}</strong>` : ""}.
      </p>
      ${input.payUrl ? `<p style="font-size:13px;color:#475569;margin:10px 0 0;line-height:1.6">You can pay online via the link below — or transfer to the bank details on the PDF.</p>` : ""}
    </td></tr>
    ${payButton}
    ${emailFooter("Reply to this email for any account questions.")}
  `);

  try {
    const sendArgs: Parameters<ReturnType<typeof getResend>["emails"]["send"]>[0] = {
      from: FROM_INVOICES,
      replyTo: REPLY_TO_ACCOUNTS,
      to: input.to,
      subject: `${typeLabel} ${input.invoiceRef} — ${input.customerName}`,
      html,
      headers: {
        "X-Cf-Doc-Type": "invoice",
        "X-Cf-Doc-Id": input.invoiceId,
      },
    };
    if (input.pdfBuffer) {
      sendArgs.attachments = [
        {
          filename: `Centrefit-Invoice-${input.invoiceRef}.pdf`,
          content: input.pdfBuffer.toString("base64"),
        },
      ];
    }
    const { error } = await getResend().emails.send(sendArgs);
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
