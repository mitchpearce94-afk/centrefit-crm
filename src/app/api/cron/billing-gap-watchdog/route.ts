import { NextRequest, NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { getAuthedClient } from "@/lib/xero/client";
import { enqueueNotification } from "@/lib/notifications/enqueue";

/**
 * Weekly billing-gap watchdog (Mon 7:45am AEST). Two checks, both born from
 * the June–July 2026 RI-swap incident where old repeating invoices were
 * deleted and their replacements started a cycle late — GC kept collecting
 * while Xero silently produced no invoices ($2.3k of gaps found 2026-07-07):
 *
 *  1. RI gap: every AUTHORISED repeating invoice's most recent expected
 *     occurrence (NextScheduledDate minus one cadence) must have a live
 *     invoice for that contact at the RI amount (±10 days). Catches skipped
 *     cycles even for invoice-only clients (e.g. Total Fusion).
 *  2. GC unmatched: every GoCardless payment that took money in the trailing
 *     window must match a live Xero invoice (amount ±$0.02, ±12 days,
 *     greedy 1:1). Catches collected-but-never-invoiced directly.
 *
 * Findings bell+email the admins (type billing.gap). Backfill remains a
 * human decision — see scripts/ri-gap-gc-recon2.mjs for the assisted flow.
 *
 * Auth: X-Cf-Cron-Secret must match CRON_SECRET (same as other crons).
 */

export const maxDuration = 300;

const RI_GAP_WINDOW_DAYS = 35;
const GC_WINDOW_DAYS = 45;

interface Finding {
  kind: "ri-gap" | "gc-unmatched";
  who: string;
  date: string;
  amount: number;
  detail: string;
}

const dayDiff = (a: string, b: string) => Math.round((Date.parse(a) - Date.parse(b)) / 86400000);
const isoDaysAgo = (n: number) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);

/**
 * Normalise the three date shapes the Xero SDK hands back (Date instance,
 * ".NET /Date(ms)/" string, ISO-ish string) to "YYYY-MM-DD", or null.
 */
function toIso(d: unknown): string | null {
  if (d == null) return null;
  if (d instanceof Date) return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
  const s = String(d);
  const dotNet = /\/Date\((\d+)/.exec(s);
  if (dotNet) return new Date(Number(dotNet[1])).toISOString().slice(0, 10);
  const iso = /^(\d{4}-\d{2}-\d{2})/.exec(s);
  if (iso) return iso[1];
  const parsed = Date.parse(s);
  return isNaN(parsed) ? null : new Date(parsed).toISOString().slice(0, 10);
}

/** Previous occurrence before `next` for a Xero schedule (MONTHLY/WEEKLY units). */
function prevOccurrence(next: string, unit: string, period: number): string | null {
  const [y, m, d] = next.split("-").map(Number);
  if (unit === "MONTHLY") {
    const yy = y + Math.floor((m - 1 - period) / 12);
    const mm = ((m - 1 - period) % 12 + 12) % 12;
    const last = new Date(Date.UTC(yy, mm + 1, 0)).getUTCDate();
    return new Date(Date.UTC(yy, mm, Math.min(d, last))).toISOString().slice(0, 10);
  }
  if (unit === "WEEKLY") {
    const dt = new Date(Date.UTC(y, m - 1, d));
    dt.setUTCDate(dt.getUTCDate() - 7 * period);
    return dt.toISOString().slice(0, 10);
  }
  return null;
}

async function gcList<T>(path: string, params: Record<string, string>): Promise<T[]> {
  const base = process.env.GOCARDLESS_ENVIRONMENT === "sandbox" ? "https://api-sandbox.gocardless.com" : "https://api.gocardless.com";
  const token = process.env.GOCARDLESS_API_TOKEN;
  if (!token) throw new Error("GOCARDLESS_API_TOKEN not configured");
  const out: T[] = [];
  let after: string | undefined;
  for (;;) {
    const q = new URLSearchParams({ limit: "500", ...params, ...(after ? { after } : {}) });
    const res = await fetch(`${base}/${path}?${q}`, {
      headers: { Authorization: `Bearer ${token}`, "GoCardless-Version": "2015-07-06", Accept: "application/json" },
    });
    if (!res.ok) throw new Error(`GC ${path} ${res.status}`);
    const j = (await res.json()) as Record<string, unknown> & { meta?: { cursors?: { after?: string } } };
    out.push(...((j[path] as T[]) ?? []));
    after = j.meta?.cursors?.after;
    if (!after) break;
  }
  return out;
}

interface GcPayment {
  amount: number;
  charge_date: string;
  status: string;
  links?: { mandate?: string };
}

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const provided = req.headers.get("x-cf-cron-secret") ?? req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!secret) return NextResponse.json({ error: "CRON_SECRET not configured" }, { status: 500 });
  if (provided !== secret) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });

  const svc = createServiceRoleClient();
  const { client: xero, conn } = await getAuthedClient(svc);
  const tenantId = conn.tenant_id;
  const today = new Date().toISOString().slice(0, 10);

  // ── Xero: live invoices over the window (+ margin), paged ──────────────────
  const since = isoDaysAgo(GC_WINDOW_DAYS + 15);
  const [sy, sm, sd] = since.split("-").map(Number);
  const invoices: { contactId: string; contactName: string; date: string; total: number; used: boolean }[] = [];
  for (let page = 1; ; page++) {
    const res = await xero.accountingApi.getInvoices(
      tenantId, undefined,
      `Type=="ACCREC" AND Date>=DateTime(${sy},${sm},${sd})`,
      "Date", undefined, undefined, undefined,
      ["DRAFT", "SUBMITTED", "AUTHORISED", "PAID"],
      page, undefined, undefined, undefined, undefined, 100,
    );
    const batch = res.body.invoices ?? [];
    for (const i of batch) {
      const date = toIso(i.date);
      if (!date) continue;
      invoices.push({
        contactId: i.contact?.contactID ?? "",
        contactName: i.contact?.name ?? "",
        date,
        total: Number(i.total ?? 0),
        used: false,
      });
    }
    if (batch.length < 100) break;
  }

  const findings: Finding[] = [];

  // ── 1. RI gaps ──────────────────────────────────────────────────────────────
  const riRes = await xero.accountingApi.getRepeatingInvoices(tenantId);
  const ris = (riRes.body.repeatingInvoices ?? []).filter(
    (r) => String(r.status) === "AUTHORISED" && String(r.type) === "ACCREC",
  );
  const gapFloor = isoDaysAgo(RI_GAP_WINDOW_DAYS);
  for (const r of ris) {
    const next = toIso(r.schedule?.nextScheduledDate);
    const unit = String(r.schedule?.unit ?? "");
    const period = Number(r.schedule?.period ?? 0);
    if (!next || !unit || !period) continue;
    const occ = prevOccurrence(next, unit, period);
    if (!occ || occ < gapFloor || occ > today) continue;
    const cid = r.contact?.contactID ?? "";
    const total = Number(r.total ?? 0);
    const covered = invoices.some(
      (i) => i.contactId === cid && Math.abs(i.total - total) < 0.02 && Math.abs(dayDiff(i.date, occ)) <= 10,
    );
    if (!covered) {
      findings.push({
        kind: "ri-gap",
        who: r.contact?.name ?? "?",
        date: occ,
        amount: total,
        detail: `RI "${r.reference ?? ""}" expected an invoice on ${occ} — none found (next scheduled ${next})`,
      });
    }
  }

  // ── 2. GC collections without an invoice ────────────────────────────────────
  const gcSince = isoDaysAgo(GC_WINDOW_DAYS);
  const payments: GcPayment[] = [];
  for (const status of ["paid_out", "confirmed"]) {
    payments.push(...(await gcList<GcPayment>("payments", {
      "charge_date[gte]": gcSince,
      "charge_date[lte]": today,
      status,
    })));
  }
  const mandates = await gcList<{ id: string; links?: { customer?: string } }>("mandates", {});
  const customers = await gcList<{ id: string; company_name?: string; given_name?: string; family_name?: string }>("customers", {});
  const custById = new Map(customers.map((c) => [c.id, c]));
  const mandById = new Map(mandates.map((m) => [m.id, m]));
  const payerName = (p: GcPayment) => {
    const m = p.links?.mandate ? mandById.get(p.links.mandate) : null;
    const c = m?.links?.customer ? custById.get(m.links.customer) : null;
    return c ? `${c.company_name ?? ""} ${c.given_name ?? ""} ${c.family_name ?? ""}`.trim() : "unknown";
  };

  for (const p of payments.sort((a, b) => a.charge_date.localeCompare(b.charge_date))) {
    const amount = p.amount / 100;
    const cands = invoices
      .filter((i) => !i.used && Math.abs(i.total - amount) < 0.02 && Math.abs(dayDiff(i.date, p.charge_date)) <= 12)
      .sort((a, b) => Math.abs(dayDiff(a.date, p.charge_date)) - Math.abs(dayDiff(b.date, p.charge_date)));
    if (cands.length > 0) {
      cands[0].used = true;
      continue;
    }
    findings.push({
      kind: "gc-unmatched",
      who: payerName(p),
      date: p.charge_date,
      amount,
      detail: `GC collected $${amount.toFixed(2)} on ${p.charge_date} (${p.status}) — no matching invoice`,
    });
  }

  // ── notify ──────────────────────────────────────────────────────────────────
  if (findings.length > 0) {
    const total = findings.reduce((s, f) => s + f.amount, 0);
    const sample = findings.slice(0, 6).map((f) => `${f.who} $${f.amount.toFixed(2)} (${f.date})`).join(", ");
    await enqueueNotification({
      typeCode: "billing.gap",
      refType: "invoice",
      refId: "billing-gap-watchdog",
      audience: { role: "admin" },
      title: `${findings.length} billing gap${findings.length === 1 ? "" : "s"} — $${total.toFixed(2)} uninvoiced`,
      body: `${sample}${findings.length > 6 ? ` +${findings.length - 6} more` : ""}. Run scripts/ri-gap-gc-recon2.mjs for the assisted backfill flow.`,
      href: "/invoices",
      metadata: { findings: findings.slice(0, 50) },
    });
  }

  return NextResponse.json({
    ok: true,
    invoicesScanned: invoices.length,
    risScanned: ris.length,
    gcPayments: payments.length,
    findings,
  });
}
