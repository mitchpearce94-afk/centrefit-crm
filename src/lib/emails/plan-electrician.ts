import "server-only";
import { Resend } from "resend";
import { emailHeader, emailFooter, emailLayout } from "@/lib/emails/brand";
import { FROM_INVOICES, REPLY_TO_ACCOUNTS } from "@/lib/emails/from-addresses";

function getResend() {
  return new Resend(process.env.RESEND_API_KEY);
}

export interface SendPlanToElectricianInput {
  to: string;
  electricianName: string | null;
  state: string;
  planLabel: string;          // e.g. "Snap Lawnton — Master Plan Rev B"
  planRevision: string | null;
  jobNumber?: string | null;
  /** PDF bytes — the rendered plan to attach. */
  pdfBuffer: Buffer;
  pdfFilename: string;
  planFileId: string;
}

export async function sendPlanToElectricianEmail(
  input: SendPlanToElectricianInput,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const greeting = input.electricianName
    ? `Hi ${input.electricianName.split(/\s+/)[0]},`
    : "Hi,";

  const html = emailLayout(`
    ${emailHeader({ rightLabel: "Plan", rightValue: input.planRevision ? `Rev ${input.planRevision}` : "" })}

    <tr><td style="padding:32px 32px 12px">
      <h1 style="font-size:20px;font-weight:600;color:#0f172a;margin:0 0 4px;letter-spacing:-0.3px">Plan attached for quote</h1>
      <p style="font-size:13px;color:#475569;margin:14px 0 0;line-height:1.6">${greeting}</p>
      <p style="font-size:13px;color:#475569;margin:10px 0 0;line-height:1.6">
        Plans attached for <strong>${input.planLabel}</strong>${input.jobNumber ? ` (${input.jobNumber})` : ""}. Can you please quote on this and get it back to me ASAP?
      </p>
    </td></tr>
    ${emailFooter("Reply with your quote when ready.")}
  `);

  try {
    const { error } = await getResend().emails.send({
      from: FROM_INVOICES,
      replyTo: REPLY_TO_ACCOUNTS,
      to: input.to,
      subject: `Plans for quote — ${input.planLabel}${input.jobNumber ? ` — ${input.jobNumber}` : ""}`,
      html,
      headers: {
        "X-Cf-Doc-Type": "plan",
        "X-Cf-Doc-Id": input.planFileId,
      },
      attachments: [
        {
          filename: input.pdfFilename,
          content: input.pdfBuffer.toString("base64"),
        },
      ],
    });
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
