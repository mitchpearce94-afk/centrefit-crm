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

export interface SuggestionResolvedItem {
  suggestionId: string;
  category: string;
  body: string;
  /** What shipped / what was decided, in plain words for the submitter. */
  resolution: string;
  /** "done" (shipped) or "declined"/"noted" (not a code change). */
  outcome: "done" | "declined" | "noted";
}

export interface SendSuggestionResolvedEmailInput {
  toEmail: string;
  toName: string;
  items: SuggestionResolvedItem[];
  /** Optional intro line, e.g. who did the work and when. */
  intro?: string;
}

/**
 * "You'll hear back once it's been looked at" — this is the hearing back.
 * One email per staff member listing each of their suggestions with what
 * was done (Mitchell, 14 Oct 2026: "email the people who suggested it with
 * what was done"). Reply-to goes to the suggestion inbox.
 */
export async function sendSuggestionResolvedEmail(
  input: SendSuggestionResolvedEmailInput,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const firstName = input.toName.trim().split(/\s+/)[0] || "there";
  const done = input.items.filter((i) => i.outcome === "done").length;
  const rows = input.items
    .map((i) => {
      const ref = i.suggestionId.replace(/-/g, "").slice(0, 8).toUpperCase();
      const pill =
        i.outcome === "done"
          ? '<span style="display:inline-block;font-size:11px;font-weight:600;color:#166534;background:#dcfce7;border-radius:999px;padding:2px 8px">Done</span>'
          : i.outcome === "declined"
            ? '<span style="display:inline-block;font-size:11px;font-weight:600;color:#991b1b;background:#fee2e2;border-radius:999px;padding:2px 8px">Not doing</span>'
            : '<span style="display:inline-block;font-size:11px;font-weight:600;color:#1e40af;background:#dbeafe;border-radius:999px;padding:2px 8px">Noted</span>';
      return `
      <tr><td style="padding:14px 0;border-top:1px solid #e2e8f0">
        <p style="font-size:12px;color:#94a3b8;margin:0 0 6px;text-transform:uppercase;letter-spacing:0.05em;">${escapeHtml(i.category)} &middot; Ref #${ref} &nbsp; ${pill}</p>
        <div style="font-size:13px;color:#475569;line-height:1.5;white-space:pre-wrap;border-left:3px solid #cbd5e1;padding:6px 12px;background:#f8fafc;border-radius:4px">${escapeHtml(i.body).replace(/\n/g, "<br/>")}</div>
        <p style="font-size:14px;color:#0f172a;margin:10px 0 0;line-height:1.6">${escapeHtml(i.resolution).replace(/\n/g, "<br/>")}</p>
      </td></tr>`;
    })
    .join("");

  const html = emailLayout(`
    ${emailHeader({ rightLabel: "Suggestions", rightValue: `${input.items.length} update${input.items.length === 1 ? "" : "s"}` })}
    <tr><td style="padding:32px 32px 12px">
      <p style="font-size:15px;color:#0f172a;margin:0 0 14px;line-height:1.6">Hi ${escapeHtml(firstName)},</p>
      <p style="font-size:14px;color:#475569;margin:0 0 18px;line-height:1.6">
        ${input.intro ? escapeHtml(input.intro) : `Here's what happened with the suggestion${input.items.length === 1 ? "" : "s"} you put through the CRM${done ? ` &mdash; ${done} ${done === 1 ? "is" : "are"} live now` : ""}.`}
      </p>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${rows}</table>
      <p style="font-size:13px;color:#475569;margin:18px 0 0;line-height:1.6">
        If something isn't working the way you expected, reply to this email and it goes straight back to the suggestion inbox.
      </p>
    </td></tr>
    ${emailFooter("Sent when suggestions submitted via the CRM are actioned.")}
  `);

  try {
    const { error } = await getResend().emails.send({
      from: FROM_NO_REPLY,
      to: input.toEmail,
      replyTo: SUGGESTION_INBOX,
      subject: input.items.length === 1
        ? `Your suggestion has been actioned (#${input.items[0].suggestionId.replace(/-/g, "").slice(0, 8).toUpperCase()})`
        : `Your CRM suggestions: ${input.items.length} updates`,
      html,
      headers: { "X-Cf-Notification-Type": "suggestion-resolved" },
      tags: [{ name: "type", value: "suggestion-resolved" }],
    });
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
