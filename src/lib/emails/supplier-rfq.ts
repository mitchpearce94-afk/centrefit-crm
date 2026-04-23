import { Resend } from "resend";

// TEMP: onboarding@resend.dev while centrefitgroup.com.au is being verified
// as a Resend sending domain. Delivers only to the Resend account signup
// address. Switch to `CentreFit Procurement <procurement@centrefitgroup.com.au>`
// once domain is verified.
const FROM_ADDRESS = "CentreFit Procurement <onboarding@resend.dev>";
const REPLY_TO = "accounts@centrefit.com.au";

function getResend() {
  return new Resend(process.env.RESEND_API_KEY);
}

function logoUrl(): string {
  const base =
    process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") ??
    "https://centrefit-crm.vercel.app";
  return `${base}/centrefit-logo.png`;
}

export interface RFQLine {
  productName: string;
  sku: string | null;
  quantity: number;
  lastKnownCost: number | null;
}

export interface SendSupplierRFQInput {
  supplierName: string;
  supplierEmail: string;
  quoteRef: string;
  siteName?: string | null;
  dueByDate?: Date | null; // optional "please reply by" hint
  lines: RFQLine[];
}

/**
 * Send a supplier a pricing request email listing the lines they'd fulfil on
 * a given quote. Supplier replies to accounts@centrefit.com.au; Mitchell (or
 * whoever's monitoring that inbox) types confirmed prices back into the CRM.
 *
 * Email is intentionally plain: logo header, item + qty only, light
 * background. Supplier is expected to reply with pricing + lead times in
 * their own format — no structured form.
 */
export async function sendSupplierRFQ(input: SendSupplierRFQInput) {
  const subject = `Pricing request — CentreFit Quote ${input.quoteRef}${
    input.siteName ? ` — ${input.siteName}` : ""
  }`;

  const rows = input.lines
    .map((l) => {
      const skuCell = l.sku
        ? `<br/><span style="font-family:'SF Mono',Consolas,monospace;font-size:12px;color:#6b7280">${l.sku}</span>`
        : "";
      return `
        <tr>
          <td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;color:#111827">${l.productName}${skuCell}</td>
          <td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;text-align:right;font-family:'SF Mono',Consolas,monospace;color:#111827">${l.quantity}</td>
        </tr>
      `;
    })
    .join("");

  const dueByLine = input.dueByDate
    ? `<p style="margin:0 0 16px 0;color:#374151"><strong>Please reply by:</strong> ${input.dueByDate.toLocaleDateString("en-AU", { day: "numeric", month: "long", year: "numeric" })}</p>`
    : "";

  const html = `<!doctype html>
<html>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#111827;-webkit-font-smoothing:antialiased">
  <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background:#f3f4f6">
    <tr><td align="center" style="padding:24px 12px">
      <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="max-width:640px;background:#ffffff;border-radius:8px;border:1px solid #e5e7eb;overflow:hidden">
        <tr>
          <td style="padding:24px 28px 0 28px">
            <img src="${logoUrl()}" alt="CentreFit Group" style="height:44px;display:block;margin-bottom:16px" />
          </td>
        </tr>

        <tr>
          <td style="padding:0 28px">
            <h1 style="margin:0 0 4px 0;font-size:22px;font-weight:600;color:#111827">Pricing request</h1>
            <p style="margin:0 0 20px 0;color:#6b7280;font-size:13px">
              Quote ${input.quoteRef}${input.siteName ? ` · ${input.siteName}` : ""}
            </p>
          </td>
        </tr>

        <tr>
          <td style="padding:0 28px">
            <p style="margin:0 0 14px 0;font-size:14px;line-height:1.55">Hi ${input.supplierName},</p>
            <p style="margin:0 0 14px 0;font-size:14px;line-height:1.55">
              We&rsquo;re preparing a quote for our client and need your current pricing on the items below.
              Please reply to this email with your current unit pricing and lead time /
              availability per line. If anything&rsquo;s discontinued or backordered, an alternative
              would be appreciated.
            </p>
            ${dueByLine}
          </td>
        </tr>

        <tr>
          <td style="padding:8px 28px 20px 28px">
            <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border-collapse:collapse;border:1px solid #e5e7eb;border-radius:6px;overflow:hidden">
              <thead>
                <tr style="background:#f9fafb">
                  <th style="text-align:left;padding:10px 12px;border-bottom:1px solid #e5e7eb;font-weight:600;color:#6b7280;text-transform:uppercase;font-size:11px;letter-spacing:0.04em">Item</th>
                  <th style="text-align:right;padding:10px 12px;border-bottom:1px solid #e5e7eb;font-weight:600;color:#6b7280;text-transform:uppercase;font-size:11px;letter-spacing:0.04em;width:80px">Qty</th>
                </tr>
              </thead>
              <tbody>${rows}</tbody>
            </table>
          </td>
        </tr>

        <tr>
          <td style="padding:0 28px 20px 28px">
            <p style="margin:0 0 6px 0;font-size:12px;color:#6b7280;line-height:1.5">
              Please reply directly to this email so our accounts team can match your response to this quote.
            </p>
            <p style="margin:0;font-size:12px;color:#6b7280;line-height:1.5">
              This is a pricing request, not an order. A formal purchase order will follow once our client approves the quote.
            </p>
          </td>
        </tr>

        <tr>
          <td style="padding:18px 28px;border-top:1px solid #e5e7eb;background:#fafafa">
            <p style="margin:0;font-size:12px;color:#6b7280;line-height:1.5">
              <strong style="color:#111827">CentreFit Group</strong><br/>
              Solutions · Communications · Services<br/>
              Reply to: <a href="mailto:${REPLY_TO}" style="color:#2563eb;text-decoration:none">${REPLY_TO}</a>
            </p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

  const { data, error } = await getResend().emails.send({
    from: FROM_ADDRESS,
    to: input.supplierEmail,
    replyTo: REPLY_TO,
    subject,
    html,
  });
  if (error) throw new Error(error.message);
  return { emailId: data?.id ?? null };
}
