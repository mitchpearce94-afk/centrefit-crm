import { Resend } from "resend";
import { FROM_NO_REPLY, REPLY_TO_ACCOUNTS } from "@/lib/emails/from-addresses";

function getResend() {
  return new Resend(process.env.RESEND_API_KEY);
}

export interface ForwardReceiptInput {
  to: string;
  cc?: string[];
  filename: string;
  /** Raw image bytes. */
  content: Buffer;
  vendor?: string | null;
  amount?: number | null;
  receiptDate?: string | null;
  jobNumber?: string | null;
  uploadedByName?: string | null;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * Forward a scanned receipt to the configured accounts mailbox as an
 * attachment. Best-effort — the caller decides whether a failure is fatal
 * (it isn't: the receipt is already stored in the CRM regardless).
 */
export async function forwardReceiptEmail(
  input: ForwardReceiptInput,
): Promise<{ ok: boolean; error?: string }> {
  if (!process.env.RESEND_API_KEY) {
    return { ok: false, error: "RESEND_API_KEY not configured" };
  }

  const row = (label: string, value: string) =>
    `<tr><td style="padding:6px 12px;font-size:12px;color:#64748b;width:120px">${escapeHtml(label)}</td><td style="padding:6px 12px;font-size:13px;color:#0a1628;font-weight:600">${escapeHtml(value)}</td></tr>`;

  const rows = [
    input.vendor ? row("Vendor", input.vendor) : "",
    input.amount != null ? row("Amount", `$${Number(input.amount).toFixed(2)}`) : "",
    input.receiptDate ? row("Date", input.receiptDate) : "",
    input.jobNumber ? row("Job", input.jobNumber) : row("Job", "Not linked to a job"),
    input.uploadedByName ? row("Scanned by", input.uploadedByName) : "",
  ].filter(Boolean).join("");

  const html = `<!doctype html><html><body style="margin:0;background:#f1f5f9;font-family:-apple-system,Segoe UI,Roboto,sans-serif">
    <table width="100%" style="background:#f1f5f9"><tr><td align="center" style="padding:28px 12px">
      <table width="100%" style="max-width:560px;background:#fff;border-radius:12px;border:1px solid #e2e8f0;overflow:hidden">
        <tr><td style="padding:20px 24px;background:#0a1628;color:#fff">
          <div style="font-size:11px;font-weight:700;letter-spacing:0.14em;color:#fbbf24;text-transform:uppercase">Centrefit · Receipt</div>
          <h1 style="margin:8px 0 0;font-size:18px;font-weight:700">Scanned receipt attached</h1>
        </td></tr>
        <tr><td style="padding:12px"><table width="100%" style="border-collapse:collapse">${rows}</table></td></tr>
        <tr><td style="padding:12px 24px 20px;font-size:12px;color:#64748b">The original receipt image is attached to this email. Captured via the Centrefit CRM receipt scanner.</td></tr>
      </table>
    </td></tr></table>
  </body></html>`;

  const subjectBits = [
    "Receipt",
    input.vendor ? `· ${input.vendor}` : "",
    input.amount != null ? `· $${Number(input.amount).toFixed(2)}` : "",
    input.jobNumber ? `· ${input.jobNumber}` : "",
    input.uploadedByName ? `· ${input.uploadedByName}` : "",
  ].filter(Boolean);

  try {
    const { error } = await getResend().emails.send({
      from: FROM_NO_REPLY,
      to: input.to,
      ...(input.cc && input.cc.length ? { cc: input.cc } : {}),
      replyTo: REPLY_TO_ACCOUNTS,
      subject: subjectBits.join(" "),
      html,
      attachments: [{ filename: input.filename, content: input.content.toString("base64") }],
    });
    if (error) return { ok: false, error: String(error.message ?? error) };
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
