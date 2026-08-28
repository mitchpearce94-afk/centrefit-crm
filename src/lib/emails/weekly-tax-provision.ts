import { Resend } from "resend";
import { FROM_NO_REPLY, REPLY_TO_ACCOUNTS } from "@/lib/emails/from-addresses";
import type { CashTaxProvision } from "@/lib/xero/cash-tax-provision";

const money = (n: number) =>
  n.toLocaleString("en-AU", { style: "currency", currency: "AUD", maximumFractionDigits: 0 });
const moneyExact = (n: number) =>
  n.toLocaleString("en-AU", { style: "currency", currency: "AUD" });

export interface ParkRecommendation {
  /** This week's transfer: QTD target minus what previous runs recommended. */
  park: number;
  alreadyParked: number;
}

/**
 * Friday-arvo tax set-aside brief. Interim until the accountant starts.
 * Catch-up model: the headline is the difference between where the tax
 * account should sit for the quarter and what previous Fridays already
 * recommended — so late bank reconciliation self-corrects week to week.
 */
export async function sendWeeklyTaxProvisionEmail(
  to: string,
  p: CashTaxProvision,
  rec: ParkRecommendation,
): Promise<{ ok: boolean; error?: string }> {
  if (!process.env.RESEND_API_KEY) return { ok: false, error: "RESEND_API_KEY not configured" };

  const row = (label: string, value: string, bold = false) =>
    `<tr><td style="padding:6px 12px;font-size:12px;color:#64748b">${label}</td><td align="right" style="padding:6px 12px;font-size:13px;color:#0a1628;font-weight:${bold ? 700 : 600};white-space:nowrap">${value}</td></tr>`;

  const html = `<!doctype html><html><body style="margin:0;background:#f1f5f9;font-family:-apple-system,Segoe UI,Roboto,sans-serif">
  <table width="100%" style="background:#f1f5f9"><tr><td align="center" style="padding:28px 12px">
    <table width="100%" style="max-width:560px;background:#fff;border-radius:12px;border:1px solid #e2e8f0;overflow:hidden">
      <tr><td style="padding:20px 24px;background:#0a1628;color:#fff">
        <div style="font-size:11px;font-weight:700;letter-spacing:0.14em;color:#fbbf24;text-transform:uppercase">Centrefit · Weekly tax set-aside</div>
        <h1 style="margin:8px 0 0;font-size:22px;font-weight:700">Transfer ${money(rec.park)} to the tax account</h1>
        <p style="margin:6px 0 0;font-size:12px;color:#94a3b8">${p.quarter.label} · cash basis · BAS due ${p.quarter.basDue}</p>
      </td></tr>

      <tr><td style="padding:16px 12px 4px">
        <div style="padding:0 12px 4px;font-size:11px;font-weight:700;letter-spacing:0.1em;color:#64748b;text-transform:uppercase">Where the tax account should sit — quarter to date</div>
        <table width="100%" style="border-collapse:collapse">
          ${row(`Cash received QTD`, moneyExact(p.quarter.cashIn))}
          ${row(`Bills paid QTD`, moneyExact(p.quarter.cashOut))}
          ${row("Net GST QTD (owed if the quarter ended today)", moneyExact(p.quarter.gstNet), true)}
          ${row("Company tax QTD (5% of cash in — estimate)", moneyExact(p.quarter.incomeTax))}
          ${row("Tax account target", moneyExact(p.quarter.target), true)}
          ${row("Recommended in previous weeks", "−" + moneyExact(rec.alreadyParked))}
          ${row("THIS WEEK'S TRANSFER", moneyExact(rec.park), true)}
        </table>
      </td></tr>

      <tr><td style="padding:8px 12px 4px">
        <div style="padding:6px 12px;font-size:11px;font-weight:700;letter-spacing:0.1em;color:#64748b;text-transform:uppercase">This week as reconciled (${p.weekStart} → ${p.weekEnd})</div>
        <table width="100%" style="border-collapse:collapse">
          ${row(`Cash received (${p.week.cashInCount} payments)`, moneyExact(p.week.cashIn))}
          ${row(`Bills paid (${p.week.cashOutCount} payments)`, moneyExact(p.week.cashOut))}
          ${row("Net GST this week", moneyExact(p.week.gstNet))}
        </table>
        <p style="margin:4px 12px 8px;font-size:11px;color:#94a3b8">If this looks low, the bank rec is probably behind — that's fine, the quarter target above self-corrects next week.</p>
      </td></tr>

      <tr><td style="padding:8px 12px 4px">
        <div style="padding:6px 12px;font-size:11px;font-weight:700;letter-spacing:0.1em;color:#64748b;text-transform:uppercase">Coming at you</div>
        <table width="100%" style="border-collapse:collapse">
          ${row(`Receivables outstanding (${p.receivables.count} invoices)`, money(p.receivables.total))}
          ${row("GST inside them (becomes payable as they're paid)", money(p.receivables.gstEmbedded))}
        </table>
      </td></tr>

      <tr><td style="padding:12px 24px 20px;font-size:11px;color:#94a3b8">
        GST uses each payment's linked-invoice tax ratio (GST-free lines handled correctly). Company tax is an assumed-margin estimate — the accountant trues this up. PAYG withholding + super from pay runs are NOT included; keep parking those separately. Auto-generated Fridays 3pm — retire this cron when the accountant starts.
      </td></tr>
    </table>
  </td></tr></table>
  </body></html>`;

  try {
    const { error } = await new Resend(process.env.RESEND_API_KEY).emails.send({
      from: FROM_NO_REPLY,
      to,
      replyTo: REPLY_TO_ACCOUNTS,
      subject: `Tax set-aside: transfer ${money(rec.park)} (quarter target ${money(p.quarter.target)})`,
      html,
    });
    if (error) return { ok: false, error: String(error.message ?? error) };
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
