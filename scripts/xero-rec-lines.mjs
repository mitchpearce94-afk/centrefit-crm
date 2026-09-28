// READ-ONLY: every Xero-side movement on 602 since 28 Jul 2026 (bank transactions, ACCPAY payments, batch payments, ACCREC payments)
// with IsReconciled flags, for matching against the ANZ statement export. Writes scripts/xero-rec-lines.json. ~12 calls.
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
const pages = async (path, key, max = 10) => { const out = []; for (let p = 1; p <= max; p++) { const d = await xget(`${path}&page=${p}`); const a = d?.[key] ?? []; out.push(...a); if (a.length < 100) break; } return out; };
const pd = (d) => { const m = /\/Date\((\d+)/.exec(d || ""); return m ? new Date(Number(m[1])).toISOString().slice(0, 10) : String(d || "").slice(0, 10); };
const W = encodeURIComponent, SINCE = "DateTime(2026,07,28)";
const tx = (await pages(`BankTransactions?where=${W(`BankAccount.Code=="602" AND Status=="AUTHORISED" AND Date>=${SINCE}`)}&order=Date`, "BankTransactions")).map((t) => ({ kind: "tx", id: t.BankTransactionID, date: pd(t.Date), type: t.Type, amount: (t.Type.startsWith("SPEND") ? -1 : 1) * Number(t.Total), contact: t.Contact?.Name || "", ref: t.Reference || "", rec: !!t.IsReconciled, lines: (t.LineItems || []).map((l) => `${l.AccountCode}:${l.LineAmount}`).join(" ") }));
const pp = (await pages(`Payments?where=${W(`PaymentType=="ACCPAYPAYMENT" AND Status=="AUTHORISED" AND Date>=${SINCE}`)}&order=Date`, "Payments")).filter((p) => p.Account?.Code === "602").map((p) => ({ kind: "billpay", id: p.PaymentID, date: pd(p.Date), amount: -Number(p.Amount), contact: p.Invoice?.Contact?.Name || "", ref: p.Invoice?.InvoiceNumber || "", rec: !!p.IsReconciled, batch: p.BatchPaymentID || null }));
const rp = JSON.parse(readFileSync(new URL("./finance-payout-crosscheck.json", import.meta.url), "utf8")); // has nothing per-payment; re-pull ACCREC since 28 Jul
const ar = (await pages(`Payments?where=${W(`PaymentType=="ACCRECPAYMENT" AND Status=="AUTHORISED" AND Date>=${SINCE}`)}&order=Date`, "Payments")).filter((p) => p.Account?.Code === "602").map((p) => ({ kind: "invpay", id: p.PaymentID, date: pd(p.Date), amount: Number(p.Amount), contact: p.Invoice?.Contact?.Name || "", ref: p.Invoice?.InvoiceNumber || "", rec: !!p.IsReconciled, batch: p.BatchPaymentID || null }));
const bp = (((await xget(`BatchPayments?where=${W(`Date>=${SINCE}`)}`))?.BatchPayments) ?? []).map((b) => ({ kind: "batch", id: b.BatchPaymentID, date: pd(b.Date), type: b.Type, amount: (b.Type === "PAYBATCH" ? -1 : 1) * Number(b.TotalAmount), n: (b.Payments || []).length, rec: !!b.IsReconciled, status: b.Status, account: b.Account?.Code, ref: b.Reference || "" }));
const out = { at: new Date().toISOString(), calls, dayLeft, tx, billpay: pp, invpay: ar, batches: bp };
writeFileSync(new URL("./xero-rec-lines.json", import.meta.url), JSON.stringify(out, null, 2));
console.log(`tx ${tx.length} (rec ${tx.filter((t) => t.rec).length}), bill payments ${pp.length} (rec ${pp.filter((t) => t.rec).length}), invoice payments ${ar.length} (rec ${ar.filter((t) => t.rec).length}), batches ${bp.length} (rec ${bp.filter((t) => t.rec).length}); calls ${calls}, day left ${dayLeft}`);
