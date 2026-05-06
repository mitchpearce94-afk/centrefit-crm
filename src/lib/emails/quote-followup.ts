import "server-only";
import { Resend } from "resend";
import { emailHeader, emailFooter, emailLayout } from "@/lib/emails/brand";
import { FROM_QUOTES, REPLY_TO_SALES } from "@/lib/emails/from-addresses";

function getResend() {
  return new Resend(process.env.RESEND_API_KEY);
}

export interface SendQuoteFollowupInput {
  to: string;
  quoteRef: string;
  quoteId: string;
  customerName: string;
  contactFirstName?: string | null;
  siteName?: string | null;
  /** Public quote-response URL — `${appUrl}/quote-response/${response_token}`. */
  respondUrl: string;
  daysSinceSent: number;
}

export async function sendQuoteFollowupEmail(
  input: SendQuoteFollowupInput,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const greeting = input.contactFirstName ? `Hi ${input.contactFirstName},` : "Hi,";

  const html = emailLayout(`
    ${emailHeader({ rightLabel: "Quotation", rightValue: input.quoteRef })}

    <tr><td style="padding:32px 32px 12px">
      <h1 style="font-size:20px;font-weight:600;color:#0f172a;margin:0 0 4px;letter-spacing:-0.3px">Just checking in on your quote</h1>
      <p style="font-size:13px;color:#475569;margin:14px 0 0;line-height:1.6">${greeting}</p>
      <p style="font-size:13px;color:#475569;margin:10px 0 0;line-height:1.6">
        We sent through your quote ${input.daysSinceSent} day${input.daysSinceSent === 1 ? "" : "s"} ago${input.siteName ? ` for <strong>${input.siteName}</strong>` : ""} and wanted to make sure it landed in your inbox.
      </p>
      <p style="font-size:13px;color:#475569;margin:10px 0 0;line-height:1.6">
        If you have any questions or need a small tweak, reply to this email — happy to help. Otherwise, you can review and accept it online below.
      </p>
    </td></tr>

    <tr><td align="center" style="padding:28px 32px 8px;text-align:center">
      <a href="${input.respondUrl}" style="display:inline-block;background:#3b82f6;color:#ffffff;text-align:center;padding:14px 28px;border-radius:10px;font-size:14px;font-weight:700;text-decoration:none;letter-spacing:0.3px">
        View &amp; Respond
      </a>
      <p style="font-size:11px;color:#94a3b8;margin:14px 0 0;text-align:center;line-height:1.5">
        Quote ${input.quoteRef} — accept, decline, or reply with questions.
      </p>
    </td></tr>

    ${emailFooter("Reply to this email if you have any questions.")}
  `);

  try {
    const { error } = await getResend().emails.send({
      from: FROM_QUOTES,
      replyTo: REPLY_TO_SALES,
      to: input.to,
      subject: `Following up on Quote ${input.quoteRef} — ${input.customerName}`,
      html,
      headers: {
        "X-Cf-Doc-Type": "quote",
        "X-Cf-Doc-Id": input.quoteId,
        "X-Cf-Email-Type": "quote-followup",
      },
    });
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
