import "server-only";
import { Resend } from "resend";
import { emailHeader, emailFooter, emailLayout } from "@/lib/emails/brand";
import { FROM_INVOICES, REPLY_TO_ACCOUNTS } from "@/lib/emails/from-addresses";

/**
 * Handover pack emails (Phase D). The pack can be large (merged datasheet
 * PDFs), so emails carry the tokenised link rather than an attachment —
 * the public page serves the current PDF (signed version once accepted).
 */

function getResend() {
  return new Resend(process.env.RESEND_API_KEY);
}

export async function sendHandoverAcceptanceEmail(opts: {
  to: string;
  recipientName: string | null;
  siteName: string;
  acceptUrl: string;
  requestId: string;
}): Promise<{ ok: boolean; error?: string }> {
  const firstName = opts.recipientName?.trim().split(/\s+/)[0] ?? null;
  const greeting = firstName ? `Hi ${firstName},` : "Hi,";

  const html = emailLayout(`
  ${emailHeader({ rightLabel: "Handover", rightValue: opts.siteName.slice(0, 24) })}

  <tr><td style="padding:32px 32px 12px">
    <h1 style="font-size:20px;font-weight:600;color:#0f172a;margin:0 0 4px;letter-spacing:-0.3px">
      Your handover documentation is ready
    </h1>
    <p style="font-size:13px;color:#475569;margin:14px 0 0;line-height:1.6">${greeting}</p>
    <p style="font-size:13px;color:#475569;margin:10px 0 0;line-height:1.6">
      The installation at <strong>${opts.siteName}</strong> is complete. Your handover pack — equipment
      datasheets, operating procedures, Wi-Fi details and our compliance statement — is ready to review
      online. Once you've had a look, sign at the link below to acknowledge receipt.
    </p>
  </td></tr>

  <tr><td align="center" style="padding:28px 32px 8px;text-align:center">
    <a href="${opts.acceptUrl}" style="display:inline-block;background:#3b82f6;color:#ffffff;text-align:center;padding:14px 28px;border-radius:10px;font-size:14px;font-weight:700;text-decoration:none;letter-spacing:0.3px;mso-padding-alt:0">
      Review &amp; Accept Handover
    </a>
    <p style="font-size:11px;color:#94a3b8;margin:14px 0 0;text-align:center;line-height:1.5">
      Questions about anything in the pack? Call us on (07) 3188 5115.
    </p>
  </td></tr>

  ${emailFooter("Reply to this email if you have any questions.")}
`);

  try {
    const { error } = await getResend().emails.send({
      from: FROM_INVOICES,
      replyTo: REPLY_TO_ACCOUNTS,
      to: [opts.to],
      subject: `Handover documentation ready — ${opts.siteName}`,
      html,
      headers: { "X-Cf-Doc-Type": "handover", "X-Cf-Doc-Id": opts.requestId },
    });
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function sendHandoverAcceptedEmail(opts: {
  to: string;
  signerName: string;
  siteName: string;
  viewUrl: string;
  requestId: string;
}): Promise<{ ok: boolean; error?: string }> {
  const firstName = opts.signerName.trim().split(/\s+/)[0] || null;
  const greeting = firstName ? `Hi ${firstName},` : "Hi,";

  const html = emailLayout(`
  ${emailHeader({ rightLabel: "Handover", rightValue: "Accepted" })}

  <tr><td style="padding:32px 32px 24px">
    <h1 style="font-size:20px;font-weight:600;color:#0f172a;margin:0 0 4px;letter-spacing:-0.3px">
      Handover accepted — thank you
    </h1>
    <p style="font-size:13px;color:#475569;margin:14px 0 0;line-height:1.6">${greeting}</p>
    <p style="font-size:13px;color:#475569;margin:10px 0 0;line-height:1.6">
      Thanks for accepting the handover documentation for <strong>${opts.siteName}</strong>. Your signed
      copy (including the acceptance record) stays available at the link below — save a copy for your
      records.
    </p>
    <p style="margin:20px 0 0;text-align:center">
      <a href="${opts.viewUrl}" style="display:inline-block;background:#3b82f6;color:#ffffff;padding:12px 24px;border-radius:10px;font-size:13px;font-weight:700;text-decoration:none">
        Download Signed Handover Pack
      </a>
    </p>
  </td></tr>

  ${emailFooter()}
`);

  try {
    const { error } = await getResend().emails.send({
      from: FROM_INVOICES,
      replyTo: REPLY_TO_ACCOUNTS,
      to: [opts.to],
      subject: `Handover accepted — ${opts.siteName}`,
      html,
      headers: { "X-Cf-Doc-Type": "handover", "X-Cf-Doc-Id": opts.requestId },
    });
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
