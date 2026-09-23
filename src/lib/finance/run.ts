import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { audit } from "./audit";
import { buildMatchContext, ingestGcPayouts, loadSettings, matchPayout, planPayout, postPayout, refreshReconciled, upsertSeenGcCustomers } from "./gc-payouts";
import { syncXeroMirror } from "./xero-mirror";
import { openXero, XeroRestError, type XeroRest } from "./xero-rest";

// One cycle of the finance agent (docs/finance-CONTEXT.md, Schedule):
// mirror → ingest → match → plan → (live) post → refresh reconciled → note.
// Safe to run any number of times a day; every step is idempotent.

export interface RunReport {
  startedAt: string;
  finishedAt?: string;
  trigger: string;
  mode: string;
  paused: boolean;
  mirror?: { contacts: number; invoices: number; pages: number; partial: boolean; reason?: string };
  ingest?: { payouts: number; newPayouts: number; items: number; gcCalls: number };
  gcCustomersAdded?: number;
  matched?: { payouts: number; items: number; matched: number; alreadyPaid: number; review: number };
  planned?: Record<string, number>;
  posted?: { ok: number; failed: number; notes: string[] };
  reconciled?: number;
  xero?: { calls: number; dayRemaining: number | null; error?: string };
  errors: string[];
}

export async function runFinanceCycle(svc: SupabaseClient, trigger: string): Promise<RunReport> {
  const settings = await loadSettings(svc);
  const report: RunReport = { startedAt: new Date().toISOString(), trigger, mode: settings.gc_payouts_mode, paused: settings.paused, errors: [] };
  if (settings.paused || settings.gc_payouts_mode === "off") {
    report.finishedAt = new Date().toISOString();
    await svc.from("finance_settings").update({ last_run_at: report.finishedAt, last_run_report: report }).eq("id", 1);
    return report;
  }

  let x: XeroRest | null = null;
  try {
    x = await openXero(svc);
    report.mirror = await syncXeroMirror(svc, x, { since: settings.ingest_since, floor: settings.xero_day_floor });
  } catch (err) {
    const msg = err instanceof XeroRestError ? `${err.message} (day remaining ${err.limits.dayRemaining ?? "?"})` : err instanceof Error ? err.message : String(err);
    report.errors.push(`xero mirror: ${msg}`);
    report.xero = { calls: x?.calls ?? 0, dayRemaining: x?.limits.dayRemaining ?? null, error: msg };
  }

  try {
    report.ingest = await ingestGcPayouts(svc, settings.ingest_since);
    report.gcCustomersAdded = await upsertSeenGcCustomers(svc);
  } catch (err) {
    report.errors.push(`gocardless ingest: ${err instanceof Error ? err.message : String(err)}`);
  }

  const { count: mirrorInvoices } = await svc.from("finance_xero_invoices").select("invoice_id", { count: "exact", head: true });
  if (!mirrorInvoices) {
    report.errors.push("xero mirror is empty — matching skipped until the first successful mirror sync");
  } else try {
    const ctx = await buildMatchContext(svc, settings.match_window_days);
    const { data: todo } = await svc.from("finance_payouts").select("id, status").eq("provider", "gocardless").in("status", ["new", "planned", "exception"]).order("arrival_date");
    const agg = { payouts: 0, items: 0, matched: 0, alreadyPaid: 0, review: 0 };
    const planned: Record<string, number> = {};
    for (const p of todo ?? []) {
      const m = await matchPayout(svc, p.id as string, ctx);
      agg.payouts += 1; agg.items += m.items; agg.matched += m.matched; agg.alreadyPaid += m.alreadyPaid; agg.review += m.review;
      const { status } = await planPayout(svc, p.id as string, settings);
      planned[status] = (planned[status] ?? 0) + 1;
    }
    report.matched = agg;
    report.planned = planned;
  } catch (err) {
    report.errors.push(`match/plan: ${err instanceof Error ? err.message : String(err)}`);
  }

  if (settings.gc_payouts_mode === "live" && x) {
    const { data: ready } = await svc.from("finance_payouts").select("id").eq("provider", "gocardless").eq("status", "planned").order("arrival_date");
    const posted = { ok: 0, failed: 0, notes: [] as string[] };
    for (const p of ready ?? []) {
      const r = await postPayout(svc, x, p.id as string);
      if (r.ok) posted.ok += 1; else { posted.failed += 1; posted.notes.push(r.note.slice(0, 160)); }
    }
    report.posted = posted;
    try { report.reconciled = await refreshReconciled(svc, x); } catch (err) { report.errors.push(`reconciled refresh: ${err instanceof Error ? err.message : String(err)}`); }
  }

  if (x) report.xero = { ...(report.xero ?? { calls: 0, dayRemaining: null }), calls: x.calls, dayRemaining: x.limits.dayRemaining };
  report.finishedAt = new Date().toISOString();
  await svc.from("finance_settings").update({ last_run_at: report.finishedAt, last_run_report: report, updated_at: new Date().toISOString() }).eq("id", 1);
  await writeDailyNote(svc, report);
  await audit(svc, { action: "cycle.finished", entity: "finance_settings", entityId: "1", after: { trigger, mode: report.mode, planned: report.planned, posted: report.posted, errors: report.errors.length }, rule: "schedule" });
  return report;
}

async function writeDailyNote(svc: SupabaseClient, r: RunReport) {
  const { data: counts } = await svc.from("finance_payouts").select("status");
  const by: Record<string, number> = {};
  for (const row of counts ?? []) by[row.status as string] = (by[row.status as string] ?? 0) + 1;
  const { count: openReview } = await svc.from("finance_review_items").select("id", { count: "exact", head: true }).eq("status", "open");
  const date = new Date(Date.now() + 10 * 3600 * 1000).toISOString().slice(0, 10); // AEST
  const lines = [
    `Finance agent — ${date} (${r.trigger}, ${r.mode}${r.paused ? ", paused" : ""})`,
    r.mirror ? `Xero mirror: ${r.mirror.contacts} contacts, ${r.mirror.invoices} invoices${r.mirror.partial ? ` — PARTIAL (${r.mirror.reason})` : ""}` : "Xero mirror: not refreshed",
    r.ingest ? `GoCardless: ${r.ingest.payouts} payouts since ingest start, ${r.ingest.newPayouts} new` : "GoCardless: not ingested",
    `Payouts: ${Object.entries(by).map(([k, v]) => `${v} ${k}`).join(", ") || "none"}`,
    r.posted ? `Posted to Xero: ${r.posted.ok} (failed ${r.posted.failed})` : r.mode === "dry_run" ? "Dry run — nothing posted" : "",
    `Waiting on you: ${by.posted ?? 0} payouts to OK in the bank rec, ${openReview ?? 0} review items`,
    r.xero ? `Xero calls used ${r.xero.calls}, daily remaining ${r.xero.dayRemaining ?? "?"}` : "",
    r.errors.length ? `Errors: ${r.errors.join(" | ")}` : "",
  ].filter(Boolean);
  await svc.from("finance_daily_notes").upsert({ date, body: lines.join("\n"), stats: { by, openReview, report: r } }, { onConflict: "date" });
}
