import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { XeroClient } from "xero-node";
import { getAuthedClient } from "@/lib/xero/client";
import { brisbaneDateISO } from "@/lib/dates";

/**
 * Weekly tax set-aside numbers (Mitchell 2026-08-28, interim until the
 * finance officer / tax agent takes over).
 *
 * Centrefit reports GST on a CASH basis, quarterly — so the BAS liability
 * follows money moving, not invoice dates:
 *   GST owed      = GST portion of customer payments RECEIVED
 *   GST credits   = GST portion of supplier bills PAID
 * The GST portion of each payment uses the linked invoice's actual
 * TotalTax/Total ratio (so GST-free lines — China-direct hardware, SG sites —
 * are handled correctly), not a flat 1/11.
 *
 * Income tax is a stated ESTIMATE: 5% of cash received (≈25% company tax on
 * an assumed ~20% net margin). True profit needs the P&L, which the Xero
 * connection can't read (no reports scope) — the accountant refines this.
 */

export interface CashTaxProvision {
  weekStart: string;
  weekEnd: string;
  week: {
    cashIn: number;
    cashInCount: number;
    gstCollected: number;
    cashOut: number;
    cashOutCount: number;
    gstCredits: number;
    gstNet: number;
    incomeTaxProvision: number;
    totalPark: number;
  };
  quarter: {
    label: string;
    start: string;
    basDue: string;
    cashIn: number;
    cashOut: number;
    gstNet: number;
    incomeTax: number;
    /** What should be sitting in the tax account for this quarter, today. */
    target: number;
  };
  receivables: {
    total: number;
    count: number;
    gstEmbedded: number;
  };
}

const INCOME_TAX_RATE_OF_CASH_IN = 0.05;

function isoParts(iso: string): [number, number, number] {
  const [y, m, d] = iso.split("-").map(Number);
  return [y, m, d];
}

/** Handles xero-node dates arriving as Date, ISO string or "/Date(ms)/". */
function paymentTime(raw: unknown): number {
  if (raw instanceof Date) return raw.getTime();
  const s = String(raw ?? "");
  const dotNet = /\/Date\((\d+)/.exec(s);
  if (dotNet) return Number(dotNet[1]);
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : 0;
}

interface PaymentLite {
  amount: number;
  time: number;
  invoiceId: string | null;
}

async function listPayments(
  xero: XeroClient,
  tenantId: string,
  type: "ACCRECPAYMENT" | "ACCPAYPAYMENT",
  fromISO: string,
  toISO: string,
): Promise<PaymentLite[]> {
  const [fy, fm, fd] = isoParts(fromISO);
  const [ty, tm, td] = isoParts(toISO);
  const where = `PaymentType=="${type}" AND Status=="AUTHORISED" AND Date >= DateTime(${fy},${fm},${fd}) AND Date <= DateTime(${ty},${tm},${td})`;
  const out: PaymentLite[] = [];
  for (let page = 1; ; page++) {
    const res = await xero.accountingApi.getPayments(tenantId, undefined, where, undefined, page);
    const batch = res.body.payments ?? [];
    for (const p of batch) {
      out.push({
        amount: p.amount ?? 0,
        time: paymentTime(p.date),
        invoiceId: p.invoice?.invoiceID ?? null,
      });
    }
    if (batch.length < 100) break;
  }
  return out;
}

/** invoiceID → TotalTax/Total ratio, fetched in batches of 40. */
async function taxRatios(
  xero: XeroClient,
  tenantId: string,
  invoiceIds: string[],
): Promise<Map<string, number>> {
  const ratios = new Map<string, number>();
  const unique = [...new Set(invoiceIds)];
  for (let i = 0; i < unique.length; i += 40) {
    const chunk = unique.slice(i, i + 40);
    const res = await xero.accountingApi.getInvoices(tenantId, undefined, undefined, undefined, chunk);
    for (const inv of res.body.invoices ?? []) {
      const total = inv.total ?? 0;
      if (inv.invoiceID) ratios.set(inv.invoiceID, total > 0 ? (inv.totalTax ?? 0) / total : 0);
    }
  }
  return ratios;
}

function gstOf(payments: PaymentLite[], ratios: Map<string, number>, fallback: number): number {
  return payments.reduce((sum, p) => {
    const r = p.invoiceId != null ? ratios.get(p.invoiceId) ?? fallback : fallback;
    return sum + p.amount * r;
  }, 0);
}

function quarterOf(todayISO: string): { start: string; label: string; basDue: string } {
  const [y, m] = isoParts(todayISO);
  if (m >= 7 && m <= 9) return { start: `${y}-07-01`, label: `Jul–Sep ${y}`, basDue: `28 Oct ${y}` };
  if (m >= 10) return { start: `${y}-10-01`, label: `Oct–Dec ${y}`, basDue: `28 Feb ${y + 1}` };
  if (m <= 3) return { start: `${y}-01-01`, label: `Jan–Mar ${y}`, basDue: `28 Apr ${y}` };
  return { start: `${y}-04-01`, label: `Apr–Jun ${y}`, basDue: `28 Jul ${y}` };
}

export async function computeCashTaxProvision(svc: SupabaseClient): Promise<CashTaxProvision> {
  const { client: xero, conn } = await getAuthedClient(svc);
  const tenantId = conn.tenant_id;

  const today = brisbaneDateISO(new Date());
  const todayUtc = new Date(`${today}T00:00:00Z`);
  const daysSinceMonday = (todayUtc.getUTCDay() + 6) % 7;
  const weekStart = new Date(todayUtc.getTime() - daysSinceMonday * 86_400_000)
    .toISOString()
    .slice(0, 10);
  const q = quarterOf(today);

  // One quarter-wide fetch per direction; the week is a client-side slice.
  const [recQ, payQ] = await Promise.all([
    listPayments(xero, tenantId, "ACCRECPAYMENT", q.start, today),
    listPayments(xero, tenantId, "ACCPAYPAYMENT", q.start, today),
  ]);
  const ratios = await taxRatios(
    xero,
    tenantId,
    [...recQ, ...payQ].map((p) => p.invoiceId).filter((x): x is string => !!x),
  );

  const weekStartMs = Date.parse(`${weekStart}T00:00:00Z`);
  const recW = recQ.filter((p) => p.time >= weekStartMs);
  const payW = payQ.filter((p) => p.time >= weekStartMs);

  const sum = (rows: PaymentLite[]) => rows.reduce((a, p) => a + p.amount, 0);
  // Fallback when a payment has no invoice link: 1/11 on money in (conservative
  // — overstates what we park), 0 on money out (doesn't inflate credits).
  const gstCollectedW = gstOf(recW, ratios, 1 / 11);
  const gstCreditsW = gstOf(payW, ratios, 0);
  const gstNetW = gstCollectedW - gstCreditsW;
  const incomeTaxW = sum(recW) * INCOME_TAX_RATE_OF_CASH_IN;

  // Receivables snapshot: what's still owed to us, and the GST inside it —
  // that GST becomes payable as this money lands (same cash basis).
  let arTotal = 0;
  let arCount = 0;
  let arGst = 0;
  for (let page = 1; ; page++) {
    const res = await xero.accountingApi.getInvoices(
      tenantId,
      undefined,
      'Type=="ACCREC" AND Status=="AUTHORISED" AND AmountDue > 0',
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      page,
    );
    const batch = res.body.invoices ?? [];
    for (const inv of batch) {
      const due = inv.amountDue ?? 0;
      const total = inv.total ?? 0;
      arTotal += due;
      arCount += 1;
      arGst += total > 0 ? due * ((inv.totalTax ?? 0) / total) : 0;
    }
    if (batch.length < 100) break;
  }

  return {
    weekStart,
    weekEnd: today,
    week: {
      cashIn: sum(recW),
      cashInCount: recW.length,
      gstCollected: gstCollectedW,
      cashOut: sum(payW),
      cashOutCount: payW.length,
      gstCredits: gstCreditsW,
      gstNet: gstNetW,
      incomeTaxProvision: incomeTaxW,
      totalPark: Math.max(0, gstNetW) + incomeTaxW,
    },
    quarter: (() => {
      const gstNetQ = gstOf(recQ, ratios, 1 / 11) - gstOf(payQ, ratios, 0);
      const incomeTaxQ = sum(recQ) * INCOME_TAX_RATE_OF_CASH_IN;
      return {
        label: q.label,
        start: q.start,
        basDue: q.basDue,
        cashIn: sum(recQ),
        cashOut: sum(payQ),
        gstNet: gstNetQ,
        incomeTax: incomeTaxQ,
        target: Math.max(0, gstNetQ) + incomeTaxQ,
      };
    })(),
    receivables: { total: arTotal, count: arCount, gstEmbedded: arGst },
  };
}
