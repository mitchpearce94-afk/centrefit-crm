import { Resend } from "resend";

// TEMP: onboarding@resend.dev while centrefitgroup.com.au is being verified
// as a Resend sending domain. Delivers only to the Resend account signup
// address. Switch to `CentreFit Procurement <procurement@centrefitgroup.com.au>`
// once domain is verified.
const FROM_ADDRESS = "CentreFit Procurement <onboarding@resend.dev>";
const REPLY_TO = "mitchpearce94@gmail.com";

function getResend() {
  return new Resend(process.env.RESEND_API_KEY);
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
 * a given quote. Supplier replies to Mitchell directly (REPLY_TO); Mitchell
 * types the confirmed prices into the CRM manually for MVP.
 */
export async function sendSupplierRFQ(input: SendSupplierRFQInput) {
  const subject = `Pricing request — CentreFit Quote ${input.quoteRef}${
    input.siteName ? ` — ${input.siteName}` : ""
  }`;

  const rows = input.lines
    .map((l) => {
      const skuCell = l.sku ? `<span style="font-family:monospace;color:#8a8f98">${l.sku}</span>` : "";
      return `
        <tr>
          <td style="padding:8px;border-bottom:1px solid #2a2e36">${l.productName}${skuCell ? `<br/>${skuCell}` : ""}</td>
          <td style="padding:8px;border-bottom:1px solid #2a2e36;text-align:right;font-family:monospace">${l.quantity}</td>
          <td style="padding:8px;border-bottom:1px solid #2a2e36;text-align:right;color:#8a8f98">&nbsp;</td>
          <td style="padding:8px;border-bottom:1px solid #2a2e36;text-align:right;color:#8a8f98">&nbsp;</td>
        </tr>
      `;
    })
    .join("");

  const dueByLine = input.dueByDate
    ? `<p style="margin:0 0 14px 0"><strong>Please reply by:</strong> ${input.dueByDate.toLocaleDateString("en-AU", { day: "numeric", month: "long", year: "numeric" })}</p>`
    : "";

  const html = `<!doctype html>
<html><body style="margin:0;padding:0;background:#0f1115;font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#dcdfe4">
  <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="max-width:640px;margin:0 auto;padding:24px">
    <tr><td>
      <h1 style="margin:0 0 6px 0;font-size:22px;color:#fff">Pricing request</h1>
      <p style="margin:0 0 18px 0;color:#8a8f98">CentreFit Group · Quote ${input.quoteRef}${input.siteName ? ` · ${input.siteName}` : ""}</p>

      <p style="margin:0 0 14px 0">Hi ${input.supplierName},</p>

      <p style="margin:0 0 14px 0">
        We&rsquo;re preparing a quote for our client and need your current pricing on the items below.
        Could you reply to this email with your <strong>current unit price</strong> and <strong>lead time / availability</strong>
        per line? If anything&rsquo;s discontinued or backordered, a suggested alternative would be appreciated.
      </p>

      ${dueByLine}

      <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border-collapse:collapse;margin:16px 0">
        <thead>
          <tr>
            <th style="text-align:left;padding:8px;border-bottom:2px solid #2a2e36;font-weight:600;color:#8a8f98;text-transform:uppercase;font-size:11px">Item</th>
            <th style="text-align:right;padding:8px;border-bottom:2px solid #2a2e36;font-weight:600;color:#8a8f98;text-transform:uppercase;font-size:11px">Qty</th>
            <th style="text-align:right;padding:8px;border-bottom:2px solid #2a2e36;font-weight:600;color:#8a8f98;text-transform:uppercase;font-size:11px">Unit price (ex-GST)</th>
            <th style="text-align:right;padding:8px;border-bottom:2px solid #2a2e36;font-weight:600;color:#8a8f98;text-transform:uppercase;font-size:11px">Lead time</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>

      <p style="margin:0 0 8px 0;color:#8a8f98;font-size:13px">
        Reply directly to this email — our ordering system is set up to match your reply to this quote.
      </p>
      <p style="margin:0 0 6px 0;color:#8a8f98;font-size:13px">
        This is a <strong>pricing request</strong>, not an order. A formal purchase order will follow once our client approves the quote.
      </p>

      <hr style="border:none;border-top:1px solid #2a2e36;margin:24px 0"/>
      <p style="margin:0;color:#8a8f98;font-size:12px">
        CentreFit Group · Solutions · Communications · Services<br/>
        Reply to: ${REPLY_TO}
      </p>
    </td></tr>
  </table>
</body></html>`;

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
