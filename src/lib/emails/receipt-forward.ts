import { Resend } from "resend";
import { REPLY_TO_ACCOUNTS } from "@/lib/emails/from-addresses";

function getResend() {
  return new Resend(process.env.RESEND_API_KEY);
}

/** What a receipt is attached to — drives the one-line template. */
export interface ReceiptTag {
  /** Fuel receipt → rego instead of a job. */
  isFuel: boolean;
  vehicleRego: string | null;
  jobNumber: string | null;
}

/**
 * The email line Jig gets — exactly Mitchell's template (2026-10-15):
 *   Please see attached receipt - no job attached
 *   Please see attached receipt - CFA05281
 *   Please see attached fuel receipt - CFT003
 * Used as both the subject and the body, and echoed on the phone.
 */
export function receiptEmailLine(tag: ReceiptTag): string {
  if (tag.isFuel) return `Please see attached fuel receipt - ${tag.vehicleRego ?? "rego not set"}`;
  if (tag.jobNumber) return `Please see attached receipt - ${tag.jobNumber}`;
  return "Please see attached receipt - no job attached";
}

/** The bit after the dash — what the phone shows in its green banner. */
export function receiptTagLabel(tag: ReceiptTag): string {
  if (tag.isFuel) return `Fuel · ${tag.vehicleRego ?? "no rego"}`;
  return tag.jobNumber ?? "No job attached";
}

export interface ForwardReceiptInput {
  to: string;
  filename: string;
  /** Raw image/PDF bytes. */
  content: Buffer;
  tag: ReceiptTag;
  /** Who scanned it — becomes the From display name so the accountant knows whose card it was. */
  uploadedByName?: string | null;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * Email a scanned receipt to the accounts destination (the accountant's
 * mailbox) as an attachment. Subject and body are the template line only —
 * nothing else to read. Best-effort: the caller records the outcome on the
 * receipts row; the image is already safe in storage regardless.
 */
export async function forwardReceiptEmail(
  input: ForwardReceiptInput,
): Promise<{ ok: boolean; error?: string }> {
  if (!process.env.RESEND_API_KEY) {
    return { ok: false, error: "RESEND_API_KEY not configured" };
  }
  const line = receiptEmailLine(input.tag);
  const fromName = input.uploadedByName?.trim() ? `${input.uploadedByName.trim()} via Centrefit CRM` : "Centrefit CRM";

  try {
    const { error } = await getResend().emails.send({
      from: `${fromName} <noreply@centrefit.com.au>`,
      to: input.to,
      replyTo: REPLY_TO_ACCOUNTS,
      subject: line,
      text: line,
      html: `<p style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;font-size:14px;color:#0a1628">${escapeHtml(line)}</p>`,
      attachments: [{ filename: input.filename, content: input.content.toString("base64") }],
    });
    if (error) return { ok: false, error: String(error.message ?? error) };
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
