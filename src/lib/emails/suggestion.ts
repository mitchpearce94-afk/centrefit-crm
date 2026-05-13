import "server-only";
import { Resend } from "resend";
import { emailHeader, emailFooter, emailLayout } from "@/lib/emails/brand";
import { FROM_NO_REPLY } from "@/lib/emails/from-addresses";

function getResend() {
  return new Resend(process.env.RESEND_API_KEY);
}

export interface SendSuggestionEmailInput {
  fromName: string;
  fromEmail: string;
  category: string;
  body: string;
}

export const SUGGESTION_INBOX = "mitchell@centrefit.com.au";

export async function sendSuggestionEmail(
  input: SendSuggestionEmailInput,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const safeBody = input.body
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\n/g, "<br/>");

  const html = emailLayout(`
    ${emailHeader({ rightLabel: "Suggestion" })}

    <tr><td style="padding:32px 32px 12px">
      <p style="font-size:13px;color:#475569;margin:0 0 14px;line-height:1.6">
        New suggestion from <strong>${input.fromName}</strong>
        &lt;${input.fromEmail}&gt;
      </p>
      <p style="font-size:12px;color:#94a3b8;margin:0 0 16px;text-transform:uppercase;letter-spacing:0.05em;">
        ${input.category}
      </p>
      <div style="font-size:14px;color:#0f172a;line-height:1.6;white-space:pre-wrap;border-left:3px solid #3b82f6;padding:8px 16px;background:#f8fafc;border-radius:4px">
        ${safeBody}
      </div>
    </td></tr>
    ${emailFooter("Submitted via the in-app Suggestion button in the CRM.")}
  `);

  try {
    const { error } = await getResend().emails.send({
      from: FROM_NO_REPLY,
      to: SUGGESTION_INBOX,
      replyTo: input.fromEmail,
      subject: `Suggestion (${input.category}) from ${input.fromName}`,
      html,
      headers: { "X-Cf-Notification-Type": "suggestion" },
      tags: [{ name: "type", value: "suggestion" }],
    });
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
