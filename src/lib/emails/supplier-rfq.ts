import { Resend } from "resend";
import { emailHeader, emailFooter, emailLayout } from "@/lib/emails/brand";
import { generateRfqPdfBuffer, type RfqPdfLine } from "@/lib/rfq-pdf";

const FROM_ADDRESS = "Centrefit Procurement <procurement@centrefit.com.au>";
const REPLY_TO = "accounts@centrefit.com.au";

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
  /** Linked job number (e.g. "JOB-2026-0042"). Falls back to quoteRef when null. */
  jobNumber?: string | null;
  siteName?: string | null;
  dueByDate?: Date | null; // optional "please reply by" hint
  lines: RFQLine[];
  /**
   * "quote" (default) phrases the email as a one-off pricing request for a
   * specific customer quote. "catalog_refresh" phrases it as a monthly
   * pricing review across all the supplier's products in our catalog.
   */
  purpose?: "quote" | "catalog_refresh";
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
  const isCatalog = input.purpose === "catalog_refresh";
  const subject = isCatalog
    ? `Monthly pricing review — CentreFit ${input.quoteRef}`
    : `Pricing request — CentreFit Quote ${input.quoteRef}${
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

  // No "please reply by" line — suppliers will treat any future date as
  // permission to take their time. We need replies same-day.

  const reference = input.jobNumber ?? input.quoteRef;

  const html = emailLayout(`
    ${emailHeader({ rightLabel: "Pricing Request", rightValue: reference })}
    <tr><td style="padding:32px 32px 8px">
      <h1 style="margin:0 0 4px;font-size:20px;font-weight:600;color:#0f172a">Pricing request</h1>
      <p style="margin:0 0 20px;color:#6b7280;font-size:12px">
        ${input.siteName ?? ""}
      </p>
      <p style="margin:0 0 14px;font-size:13px;line-height:1.55;color:#475569">Hi ${input.supplierName},</p>
      <p style="margin:0 0 14px;font-size:13px;line-height:1.6;color:#475569">
        ${
          isCatalog
            ? `As part of our monthly catalog review, we'd like to confirm your current pricing on the items below. Please reply to <a href="mailto:${REPLY_TO}" style="color:#2563eb;text-decoration:none"><strong>${REPLY_TO}</strong></a> with your current unit pricing and quote <strong>${reference}</strong> as the reference. Flag anything discontinued or backordered.`
            : `We're preparing a quote for our client and need your current pricing on the items below. Please reply to <a href="mailto:${REPLY_TO}" style="color:#2563eb;text-decoration:none"><strong>${REPLY_TO}</strong></a> with a quote of your current unit pricing with <strong>${reference}</strong> as the reference. If anything is discontinued or backordered, an alternative would be appreciated.`
        }
      </p>
      <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border-collapse:collapse;border:1px solid #e5e7eb;border-radius:6px;overflow:hidden;margin:8px 0 18px">
        <thead>
          <tr style="background:#f9fafb">
            <th style="text-align:left;padding:10px 12px;border-bottom:1px solid #e5e7eb;font-weight:700;color:#6b7280;text-transform:uppercase;font-size:11px;letter-spacing:0.04em">Item</th>
            <th style="text-align:right;padding:10px 12px;border-bottom:1px solid #e5e7eb;font-weight:700;color:#6b7280;text-transform:uppercase;font-size:11px;letter-spacing:0.04em;width:80px">Qty</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </td></tr>
    ${emailFooter()}
  `);

  // Generate a printable PDF version so the supplier can mark prices in
  // pen and email a scan back if they prefer that to typing into a reply.
  let pdfBuffer: Buffer | null = null;
  try {
    const pdfLines: RfqPdfLine[] = input.lines.map((l) => ({
      productName: l.productName,
      sku: l.sku,
      quantity: l.quantity,
    }));
    pdfBuffer = await generateRfqPdfBuffer({
      supplierName: input.supplierName,
      quoteRef: input.quoteRef,
      jobNumber: input.jobNumber ?? null,
      siteName: input.siteName ?? null,
      dueByDate: input.dueByDate ?? null,
      lines: pdfLines,
    });
  } catch (err) {
    // PDF gen failures shouldn't block the email — supplier still gets the
    // HTML version with the full item list.
    console.error("[RFQ] PDF generation failed, sending email without attachment:", err);
  }

  const filename = `Centrefit-RFQ-${input.quoteRef}.pdf`;
  const { data, error } = await getResend().emails.send({
    from: FROM_ADDRESS,
    to: input.supplierEmail,
    replyTo: REPLY_TO,
    subject,
    html,
    ...(pdfBuffer
      ? { attachments: [{ filename, content: pdfBuffer.toString("base64") }] }
      : {}),
  });
  if (error) throw new Error(error.message);
  return { emailId: data?.id ?? null };
}
