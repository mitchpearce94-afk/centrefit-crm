import "server-only";
import { Resend } from "resend";
import { emailHeader, emailFooter, emailLayout } from "@/lib/emails/brand";
import { FROM_NO_REPLY } from "@/lib/emails/from-addresses";

function getResend() {
  return new Resend(process.env.RESEND_API_KEY);
}

export interface SendNotificationEmailInput {
  to: string;
  /** Recipient first name for the greeting; falls back to "there". */
  greetingName: string | null;
  /** Notification title — also used as subject line. */
  title: string;
  /** Optional body / context line. */
  body?: string | null;
  /** Deep-link button label, e.g. "Open quote". Hidden when href is null. */
  ctaLabel?: string;
  /** Absolute URL to deep-link the recipient into the CRM. */
  href: string | null;
  /** Tag for grouping in Resend (e.g. "quote.accepted"). */
  typeCode: string;
}

export async function sendNotificationEmail(
  input: SendNotificationEmailInput,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const greeting = input.greetingName ? `Hi ${input.greetingName},` : "Hi there,";
  const cta = input.href
    ? `
      <tr><td align="center" style="padding:24px 32px 8px;text-align:center">
        <a href="${input.href}" style="display:inline-block;background:#3b82f6;color:#ffffff;text-align:center;padding:12px 24px;border-radius:10px;font-size:14px;font-weight:700;text-decoration:none;letter-spacing:0.3px">
          ${input.ctaLabel ?? "Open in CRM"}
        </a>
      </td></tr>`
    : "";

  const html = emailLayout(`
    ${emailHeader({ rightLabel: "Notification" })}

    <tr><td style="padding:32px 32px 12px">
      <p style="font-size:13px;color:#475569;margin:0 0 14px;line-height:1.6">${greeting}</p>
      <h1 style="font-size:18px;font-weight:600;color:#0f172a;margin:0 0 6px;letter-spacing:-0.2px">${input.title}</h1>
      ${input.body ? `<p style="font-size:13px;color:#475569;margin:8px 0 0;line-height:1.6">${input.body}</p>` : ""}
    </td></tr>
    ${cta}
    ${emailFooter("Manage which events email you in Settings → Notifications.")}
  `);

  try {
    const { error } = await getResend().emails.send({
      from: FROM_NO_REPLY,
      to: input.to,
      subject: input.title,
      html,
      headers: {
        "X-Cf-Notification-Type": input.typeCode,
      },
      tags: [{ name: "type", value: input.typeCode.replace(/[^a-zA-Z0-9_]/g, "_") }],
    });
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
