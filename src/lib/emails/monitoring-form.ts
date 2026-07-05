import "server-only";
import { Resend } from "resend";
import { emailHeader, emailFooter, emailLayout } from "@/lib/emails/brand";
import { FROM_INVOICES, REPLY_TO_ACCOUNTS } from "@/lib/emails/from-addresses";

/**
 * Security Monitoring Response Instructions emails (Phase B). Sent from
 * accounts@ per docs/documentation-CONTEXT.md — the signing request with the
 * tokenised form link, and the signed-copy confirmation with the PDF
 * attached ("we recommend you take a copy for your records" from the paper
 * form, done for them).
 */

function getResend() {
  return new Resend(process.env.RESEND_API_KEY);
}

export async function sendMonitoringFormRequestEmail(opts: {
  to: string;
  recipientName: string | null;
  siteName: string;
  formUrl: string;
  version: number;
  isReissue: boolean;
  requestId: string;
}): Promise<{ ok: boolean; error?: string }> {
  const firstName = opts.recipientName?.trim().split(/\s+/)[0] ?? null;
  const greeting = firstName ? `Hi ${firstName},` : "Hi,";

  const html = emailLayout(`
  ${emailHeader({ rightLabel: "Security Monitoring", rightValue: `v${opts.version}` })}

  <tr><td style="padding:32px 32px 12px">
    <h1 style="font-size:20px;font-weight:600;color:#0f172a;margin:0 0 4px;letter-spacing:-0.3px">
      Your monitoring instructions ${opts.isReissue ? "need updating" : "are ready to complete"}
    </h1>
    <p style="font-size:13px;color:#475569;margin:14px 0 0;line-height:1.6">${greeting}</p>
    <p style="font-size:13px;color:#475569;margin:10px 0 0;line-height:1.6">
      ${opts.isReissue
        ? `Please review and confirm the Security Monitoring Response Instructions for <strong>${opts.siteName}</strong>. The form is pre-filled with your current instructions — only change what needs updating, then sign at the end.`
        : `Please complete the Security Monitoring Response Instructions for <strong>${opts.siteName}</strong>. This tells our 24/7 Control Room exactly how to respond to each type of alarm at your facility.`}
    </p>
    <p style="font-size:13px;color:#475569;margin:10px 0 0;line-height:1.6">
      The form takes about 10 minutes on any phone, tablet or computer, and is signed electronically —
      no printing or scanning required. A signed PDF copy will be emailed to you for your records.
    </p>
  </td></tr>

  <tr><td align="center" style="padding:28px 32px 8px;text-align:center">
    <a href="${opts.formUrl}" style="display:inline-block;background:#3b82f6;color:#ffffff;text-align:center;padding:14px 28px;border-radius:10px;font-size:14px;font-weight:700;text-decoration:none;letter-spacing:0.3px;mso-padding-alt:0">
      Complete &amp; Sign Online
    </a>
    <p style="font-size:11px;color:#94a3b8;margin:14px 0 0;text-align:center;line-height:1.5">
      Not sure which options to choose? Call us on (07) 3188 5115 during business hours and we&rsquo;ll walk you through it.
    </p>
  </td></tr>

  ${emailFooter("Reply to this email if you have any questions.")}
`);

  try {
    const { error } = await getResend().emails.send({
      from: FROM_INVOICES,
      replyTo: REPLY_TO_ACCOUNTS,
      to: [opts.to],
      subject: `Action required — Security Monitoring Instructions for ${opts.siteName}`,
      html,
      headers: {
        "X-Cf-Doc-Type": "monitoring_form",
        "X-Cf-Doc-Id": opts.requestId,
      },
    });
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function sendMonitoringFormSignedEmail(opts: {
  to: string;
  signerName: string;
  siteName: string;
  version: number;
  pdfBuffer: Buffer;
  requestId: string;
}): Promise<{ ok: boolean; error?: string }> {
  const firstName = opts.signerName.trim().split(/\s+/)[0] || null;
  const greeting = firstName ? `Hi ${firstName},` : "Hi,";

  const html = emailLayout(`
  ${emailHeader({ rightLabel: "Security Monitoring", rightValue: `v${opts.version}` })}

  <tr><td style="padding:32px 32px 24px">
    <h1 style="font-size:20px;font-weight:600;color:#0f172a;margin:0 0 4px;letter-spacing:-0.3px">
      Instructions signed — your copy is attached
    </h1>
    <p style="font-size:13px;color:#475569;margin:14px 0 0;line-height:1.6">${greeting}</p>
    <p style="font-size:13px;color:#475569;margin:10px 0 0;line-height:1.6">
      Thanks for completing the Security Monitoring Response Instructions for
      <strong>${opts.siteName}</strong>. Your signed copy is attached for your records, and our 24/7
      Control Room will action alarms exactly as instructed.
    </p>
    <p style="font-size:13px;color:#475569;margin:10px 0 0;line-height:1.6">
      If these details ever change — staff, call list, PINs or response preferences — contact us on
      (07) 3188 5115 and we&rsquo;ll issue a fresh form.
    </p>
  </td></tr>

  ${emailFooter()}
`);

  try {
    const { error } = await getResend().emails.send({
      from: FROM_INVOICES,
      replyTo: REPLY_TO_ACCOUNTS,
      to: [opts.to],
      subject: `Signed — Security Monitoring Instructions for ${opts.siteName}`,
      html,
      headers: {
        "X-Cf-Doc-Type": "monitoring_form",
        "X-Cf-Doc-Id": opts.requestId,
      },
      attachments: [
        {
          filename: `Centrefit-Security-Monitoring-Instructions-v${opts.version}.pdf`,
          content: opts.pdfBuffer.toString("base64"),
        },
      ],
    });
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
