import "server-only";
import { Resend } from "resend";
import { emailHeader, emailFooter, emailLayout } from "@/lib/emails/brand";
import { FROM_NO_REPLY } from "@/lib/emails/from-addresses";

function getResend() {
  return new Resend(process.env.RESEND_API_KEY);
}

/** Escape user-sourced strings (customer names etc.) for HTML interpolation. */
function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export interface SendNotificationEmailInput {
  to: string;
  /** Recipient first name for the greeting; falls back to "there". */
  greetingName: string | null;
  /** Notification title — also used as subject line. */
  title: string;
  /** Optional body / context line. */
  body?: string | null;
  /**
   * Entity specifics rendered as a label/value table under the body —
   * e.g. Job #, Customer, Site, Amount. This is what makes the email
   * self-contained instead of a bare headline.
   */
  details?: { label: string; value: string }[];
  /** Deep-link button label, e.g. "View Job 5018". Hidden when href is null. */
  ctaLabel?: string;
  /** Absolute URL to deep-link the recipient into the CRM. */
  href: string | null;
  /** Tag for grouping in Resend (e.g. "quote.accepted"). */
  typeCode: string;
  /** Files to attach (e.g. plan PDF on a Notify Staff for a plan). */
  attachments?: { filename: string; content: Buffer }[];
}

export async function sendNotificationEmail(
  input: SendNotificationEmailInput,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const greeting = input.greetingName ? `Hi ${esc(input.greetingName)},` : "Hi there,";
  const cta = input.href
    ? `
      <tr><td align="center" style="padding:24px 32px 8px;text-align:center">
        <a href="${input.href}" style="display:inline-block;background:#3b82f6;color:#ffffff;text-align:center;padding:12px 24px;border-radius:10px;font-size:14px;font-weight:700;text-decoration:none;letter-spacing:0.3px">
          ${input.ctaLabel ? esc(input.ctaLabel) : "Open in CRM"}
        </a>
      </td></tr>`
    : "";

  const detailRows = (input.details ?? []).filter((d) => d.value && d.value.trim() !== "");
  const detailsBlock = detailRows.length > 0
    ? `
      <tr><td style="padding:16px 32px 0">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px">
          ${detailRows
            .map(
              (d, i) => `
          <tr>
            <td style="padding:${i === 0 ? "12px" : "8px"} 16px ${i === detailRows.length - 1 ? "12px" : "0"};font-size:12px;color:#64748b;white-space:nowrap;vertical-align:top;width:110px">${esc(d.label)}</td>
            <td style="padding:${i === 0 ? "12px" : "8px"} 16px ${i === detailRows.length - 1 ? "12px" : "0"} 0;font-size:13px;color:#0f172a;font-weight:500;vertical-align:top">${esc(d.value)}</td>
          </tr>`,
            )
            .join("")}
        </table>
      </td></tr>`
    : "";

  const html = emailLayout(`
    ${emailHeader({ rightLabel: "Notification" })}

    <tr><td style="padding:32px 32px 12px">
      <p style="font-size:13px;color:#475569;margin:0 0 14px;line-height:1.6">${greeting}</p>
      <h1 style="font-size:18px;font-weight:600;color:#0f172a;margin:0 0 6px;letter-spacing:-0.2px">${esc(input.title)}</h1>
      ${input.body ? `<p style="font-size:13px;color:#475569;margin:8px 0 0;line-height:1.6">${esc(input.body)}</p>` : ""}
    </td></tr>
    ${detailsBlock}
    ${cta}
    ${emailFooter("Manage which events email you in Settings → Notifications.")}
  `);

  try {
    const sendArgs: Parameters<ReturnType<typeof getResend>["emails"]["send"]>[0] = {
      from: FROM_NO_REPLY,
      to: input.to,
      subject: input.title,
      html,
      headers: {
        "X-Cf-Notification-Type": input.typeCode,
      },
      tags: [{ name: "type", value: input.typeCode.replace(/[^a-zA-Z0-9_]/g, "_") }],
    };
    if (input.attachments && input.attachments.length > 0) {
      sendArgs.attachments = input.attachments.map((a) => ({
        filename: a.filename,
        content: a.content.toString("base64"),
      }));
    }
    const { error } = await getResend().emails.send(sendArgs);
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
