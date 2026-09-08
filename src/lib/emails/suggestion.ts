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

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export interface SendSuggestionReceiptInput {
  toEmail: string;
  toName: string;
  category: string;
  body: string;
  suggestionId: string;
}

/**
 * Confirmation back to the staff member who submitted the suggestion:
 * "got it, here's a copy of what you sent". Gives them a reference number
 * and a reply-to straight into the suggestion inbox so they can add to it.
 * Best-effort — callers must never fail the submission on this.
 */
export async function sendSuggestionReceiptEmail(
  input: SendSuggestionReceiptInput,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const firstName = input.toName.trim().split(/\s+/)[0] || "there";
  const ref = input.suggestionId.replace(/-/g, "").slice(0, 8).toUpperCase();
  const safeBody = escapeHtml(input.body).replace(/\n/g, "<br/>");

  const html = emailLayout(`
    ${emailHeader({ rightLabel: "Suggestion", rightValue: `#${ref}` })}

    <tr><td style="padding:32px 32px 12px">
      <p style="font-size:15px;color:#0f172a;margin:0 0 14px;line-height:1.6">
        Hi ${escapeHtml(firstName)},
      </p>
      <p style="font-size:14px;color:#475569;margin:0 0 18px;line-height:1.6">
        Your suggestion has been submitted and is in the queue for review.
        Here's a copy of what you sent:
      </p>
      <p style="font-size:12px;color:#94a3b8;margin:0 0 8px;text-transform:uppercase;letter-spacing:0.05em;">
        ${escapeHtml(input.category)} &middot; Ref #${ref}
      </p>
      <div style="font-size:14px;color:#0f172a;line-height:1.6;white-space:pre-wrap;border-left:3px solid #3b82f6;padding:8px 16px;background:#f8fafc;border-radius:4px">
        ${safeBody}
      </div>
      <p style="font-size:13px;color:#475569;margin:18px 0 0;line-height:1.6">
        Reply to this email if you want to add anything. You'll hear back once it's been looked at.
      </p>
    </td></tr>
    ${emailFooter("Sent automatically when a suggestion is submitted via the CRM.")}
  `);

  try {
    const { error } = await getResend().emails.send({
      from: FROM_NO_REPLY,
      to: input.toEmail,
      replyTo: SUGGESTION_INBOX,
      subject: `Your ${input.category} suggestion has been submitted (#${ref})`,
      html,
      headers: { "X-Cf-Notification-Type": "suggestion-receipt" },
      tags: [{ name: "type", value: "suggestion-receipt" }],
    });
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
