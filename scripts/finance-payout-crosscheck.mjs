// READ-ONLY cross-check: for every GC payout the agent knows, compare its GROSS to the ACCREC payments Xero holds in 602 on the arrival date
// (Mitchell's Find & Match dates payments on the statement-line date). Writes scripts/finance-payout-crosscheck.json. ~10 Xero calls.
import { readFileSync, writeFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
const env = Object.fromEntries(readFileSync(new URL("../.env.gc-probe", import.meta.url), "utf8").split("\n").filter((l) => l.includes("=")).map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, "").replace(/\\r|\\n/g, "").replace(/\r|\n/g, "").trim()]; }));
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const { data: conn } = await sb.from("xero_connections").select("id, tenant_id, access_token, refresh_token, expires_at").order("updated_at", { ascending: false }).limit(1).single();
let at = conn.access_token;
if (!conn.expires_at || new Date(conn.expires_at).getTime() < Date.now() + 60_000) {
  const res = await fetch("https://identity.xero.com/connect/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", Authorization: "Basic " + Buffer.from(`${env.XERO_CLIENT_ID}:${env.XERO_CLIENT_SECRET}`).toString("base64") }, body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: conn.refresh_token }) });
  const tok = await res.json(); if (!res.ok) { console.error("refresh failed", JSON.stringify(tok)); process.exit(1); }
  at = tok.access_token; await sb.from("xero_connections").update({ access_token: tok.access_token, refresh_token: tok.refresh_token ?? conn.refresh_token, expires_at: new Date(Date.now() + (tok.expires_in ?? 1800) * 1000).toISOString(), updated_at: new Date().toISOString() }).eq("id", conn.id);
}
let calls = 0, dayLeft;
const xget = async (p) => { const r = await fetch(`https://api.xero.com/api.xro/2.0/${p}`, { headers: { Authorization: `Bearer ${at}`, "Xero-tenant-id": conn.tenant_id, Accept: "application/json" } }); calls++; dayLeft = r.headers.get("x-daylimit-remaining") ?? dayLeft; const t = await r.text(); if (!r.ok) { console.error(r.status, t.slice(0, 150)); return null; } return JSON.parse(t); };
const pd = (d) => { const m = /\/Date\((\d+)/.exec(d || ""); return m ? new Date(Number(m[1])).toISOString().slice(0, 10) : String(d || "").slice(0, 10); };
const pays = [];
for (let p = 1; p <= 12; p++) { const d = await xget(`Payments?where=${encodeURIComponent('PaymentType=="ACCRECPAYMENT" AND Status=="AUTHORISED" AND Date>=DateTime(2026,06,25)')}&order=Date&page=${p}`); const a = d?.Payments ?? []; pays.push(...a); if (a.length < 100) break; }
const in602 = pays.filter((p) => p.Account?.Code === "602").map((p) => ({ id: p.PaymentID, date: pd(p.Date), amount: p.Amount, invoice: p.Invoice?.InvoiceNumber, contact: p.Invoice?.Contact?.Name, rec: p.IsReconciled, batch: p.BatchPaymentID || null, ref: p.Reference || "" }));
const byDate = {}; for (const p of in602) (byDate[p.date] ||= []).push(p);
const { data: payouts } = await sb.from("finance_payouts").select("id,provider_payout_id,arrival_date,net_cents,fee_cents,gross_cents,status,items_total,items_matched,exception").order("arrival_date");
const { data: items } = await sb.from("finance_payout_items").select("payout_id,item_type,amount_cents,match_status,xero_contact_name,invoice_number,description").eq("item_type", "payment_paid_out");
const rows = [];
for (const po of payouts) {
  const its = items.filter((i) => i.payout_id === po.id);
  const gross = po.gross_cents / 100, net = po.net_cents / 100;
  const sameDay = (byDate[po.arrival_date] || []).filter((p) => !p.batch || true);
  const sum = +sameDay.reduce((s, p) => s + p.amount, 0).toFixed(2);
  // payments whose amounts exactly cover the payout's items (multiset match), on the arrival date
  const pool = sameDay.map((p) => p.amount); const covered = [];
  for (const i of its) { const a = i.amount_cents / 100; const k = pool.findIndex((x) => Math.abs(x - a) < 0.005); if (k >= 0) { pool.splice(k, 1); covered.push(a); } }
  const st = {}; for (const i of its) st[i.match_status] = (st[i.match_status] || 0) + 1;
  const verdict = its.length && covered.length === its.length ? "DONE (all items have same-day payments)" : covered.length ? `PARTIAL ${covered.length}/${its.length} items paid same day` : sum === 0 ? "NOTHING in Xero that day" : `UNCLEAR (${sum} paid that day vs gross ${gross})`;
  rows.push({ id: po.id, date: po.arrival_date, gc: po.provider_payout_id, net, gross, items: its.length, agent: po.status, states: st, sameDayPayments: sameDay.length, sameDaySum: sum, covered: covered.length, verdict });
}
writeFileSync(new URL("./finance-payout-crosscheck.json", import.meta.url), JSON.stringify({ at: new Date().toISOString(), calls, dayLeft, payments602: in602.length, rows }, null, 2));
console.log(`payments since 25 Jun in 602: ${in602.length} (${pays.length} total), Xero calls ${calls}, day left ${dayLeft}\n`);
for (const r of rows) console.log(`${r.date} net $${r.net.toFixed(2).padStart(8)} gross $${r.gross.toFixed(2).padStart(8)} items ${String(r.items).padStart(2)} agent=${r.agent.padEnd(10)} ${JSON.stringify(r.states).padEnd(60)} → ${r.verdict}`);
const done = rows.filter((r) => r.verdict.startsWith("DONE")).length; console.log(`\nDONE ${done} / ${rows.length}; PARTIAL ${rows.filter((r) => r.verdict.startsWith("PARTIAL")).length}; NOTHING ${rows.filter((r) => r.verdict.startsWith("NOTHING")).length}`);
