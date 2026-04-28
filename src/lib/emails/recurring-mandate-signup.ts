import "server-only";
import { Resend } from "resend";
import { emailHeader, emailFooter, emailLayout } from "@/lib/emails/brand";

const FROM_ADDRESS = "Centrefit Accounts <accounts@centrefit.com.au>";
const REPLY_TO = "accounts@centrefit.com.au";

function getResend() {
  return new Resend(process.env.RESEND_API_KEY);
}

export interface MandateLink {
  /** Display name for the site this mandate covers, e.g. "Snap Fitness Tuggerah". */
  siteLabel: string;
  /** GC-hosted authorisation URL for this site's mandate. */
  url: string;
  /** Bullet-point summary of services on the plan. */
  serviceSummary: string;
  /** "$X.XX/month + $Y.YY/year" or similar — short total line. */
  recurringSummary: string;
}

export interface SendMandateSignupInput {
  /** Recipient (the customer's primary contact email). */
  to: string;
  /** Customer-friendly name shown in the greeting. */
  customerName: string;
  /** One mandate link per site they're being onboarded for. */
  links: MandateLink[];
}

/**
 * Send a customer one consolidated email containing N mandate signup
 * links — one per facility/site. Each link goes to a GoCardless-hosted
 * authorisation form pre-filled with the right alias email so the
 * resulting mandate auto-matches the matching Xero contact.
 *
 * Plain, branded, no marketing copy. Just: here's what we're billing you,
 * here's the link, click each one, you'll only enter bank details once
 * per facility.
 */
export async function sendMandateSignupEmail(input: SendMandateSignupInput) {
  const { to, customerName, links } = input;
  if (links.length === 0) throw new Error("Cannot send mandate email with no links");

  const subject = links.length === 1
    ? `Set up direct debit for ${links[0].siteLabel}`
    : `Set up direct debit for your ${links.length} Centrefit-managed sites`;

  const intro = links.length === 1
    ? `<p style="font-size:14px;line-height:1.6;color:#111827;margin:0 0 18px">Hi ${escape(customerName)},</p>
       <p style="font-size:14px;line-height:1.6;color:#111827;margin:0 0 18px">
         To get your recurring services set up, please complete the direct debit authorisation below.
         You'll only need to enter your bank details once and future invoices will be auto-debited
         on the schedule shown.
       </p>`
    : `<p style="font-size:14px;line-height:1.6;color:#111827;margin:0 0 18px">Hi ${escape(customerName)},</p>
       <p style="font-size:14px;line-height:1.6;color:#111827;margin:0 0 18px">
         You're being onboarded for direct debit at <strong>${links.length} sites</strong>. Each site
         needs its own authorisation so the right facility's invoices flow against the right account.
         Please click each button below and complete the form — same bank details, just enter them
         once per site.
       </p>
       <div style="border-left:3px solid #2563eb;background:#eff6ff;padding:12px 14px;margin:0 0 18px;border-radius:0 6px 6px 0">
         <p style="margin:0 0 4px;font-size:12px;font-weight:600;color:#1e3a8a">A note on the email shown on each form</p>
         <p style="margin:0;font-size:12px;line-height:1.55;color:#1e3a8a">
           You'll see your email displayed slightly differently on each site's form
           (e.g. <span style="font-family:Consolas,Menlo,monospace">you+sitename@your-domain.com</span>).
           That's intentional — it's how we route each site's invoices to the right facility on our
           end. Please leave it as shown; messages to that variant still land in your normal inbox.
         </p>
       </div>`;

  const linkBlocks = links.map((link, i) => `
    <div style="border:1px solid #e5e7eb;border-radius:10px;padding:18px 20px;margin-bottom:12px;background:#fafafa">
      <p style="margin:0 0 6px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:1.2px;color:#6b7280">
        Site ${i + 1} of ${links.length}
      </p>
      <p style="margin:0 0 8px;font-size:16px;font-weight:600;color:#111827">${escape(link.siteLabel)}</p>
      <p style="margin:0 0 4px;font-size:13px;line-height:1.55;color:#374151">${escape(link.serviceSummary)}</p>
      <p style="margin:0 0 14px;font-size:12px;color:#6b7280">${escape(link.recurringSummary)}</p>
      <a href="${link.url}"
         style="display:inline-block;background:#111827;color:#ffffff;padding:10px 20px;border-radius:6px;
                font-size:13px;font-weight:600;text-decoration:none">
        Set up direct debit →
      </a>
    </div>
  `).join("");

  const body = `
    ${emailHeader({ rightLabel: "Recurring billing", rightValue: links.length === 1 ? "1 site" : `${links.length} sites` })}
    ${intro}
    ${linkBlocks}
    <p style="font-size:12px;line-height:1.55;color:#6b7280;margin:18px 0 0">
      Direct debits are processed through GoCardless on Centrefit's behalf. You can cancel
      a mandate at any time by replying to this email.
    </p>
    ${emailFooter()}
  `;

  await getResend().emails.send({
    from: FROM_ADDRESS,
    to: [to],
    replyTo: REPLY_TO,
    subject,
    html: emailLayout(body),
  });
}

function escape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
