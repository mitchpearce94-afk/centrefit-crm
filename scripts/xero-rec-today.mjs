// READ-ONLY: the Xero-side picture for a bank reconciliation session (Mitchell + Cortex, 28 Sep 2026).
// Pulls bank accounts, bills awaiting payment, invoices awaiting payment (recent), draft bills, unreconciled
// bank transactions + payments per bank account, and recent batch payments. Writes scripts/xero-rec-today.json.
// NOTHING is written to Xero. ~12 API calls. Auth pattern = xero-awaiting-bills-recheck.mjs.
import { readFileSync, writeFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const env = Object.fromEntries(readFileSync(new URL("../.env.gc-probe", import.meta.url), "utf8").split("\n").filter((l) => l.includes("=")).map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, "").replace(/\\r|\\n/g, "").replace(/\r|\n/g, "").trim()]; }));
const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const { data: conn } = await supabase.from("xero_connections").select("id, tenant_id, access_token, refresh_token, expires_at").order("updated_at", { ascending: false }).limit(1).single();
let accessToken = conn.access_token;
if (!conn.expires_at || new Date(conn.expires_at).getTime() < Date.now() + 60_000) {
  const res = await fetch("https://identity.xero.com/connect/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", Authorization: "Basic " + Buffer.from(`${env.XERO_CLIENT_ID}:${env.XERO_CLIENT_SECRET}`).toString("base64") }, body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: conn.refresh_token }) });
  const tok = await res.json(); if (!res.ok) { console.error("refresh failed", JSON.stringify(tok)); process.exit(1); }
  accessToken = tok.access_token;
  await supabase.from("xero_connections").update({ access_token: tok.access_token, refresh_token: tok.refresh_token ?? conn.refresh_token, expires_at: new Date(Date.now() + (tok.expires_in ?? 1800) * 1000).toISOString(), updated_at: new Date().toISOString() }).eq("id", conn.id);
}
let calls = 0, dayLeft = null;
const xeroGet = async (path) => {
  const res = await fetch(`https://api.xero.com/api.xro/2.0/${path}`, { headers: { Authorization: `Bearer ${accessToken}`, "Xero-tenant-id": conn.tenant_id, Accept: "application/json" } });
  calls++; dayLeft = res.headers.get("x-daylimit-remaining") ?? dayLeft;
  const text = await res.text(); let data = null; try { data = JSON.parse(text); } catch {}
  if (!res.ok) { console.error(`[WARN] ${path.split("?")[0]}: ${res.status} ${text.slice(0, 160)}`); return null; }
  return data;
};
const pages = async (path, key, max = 6) => { const out = []; for (let p = 1; p <= max; p++) { const d = await xeroGet(`${path}${path.includes("?") ? "&" : "?"}page=${p}`); const arr = d?.[key] ?? []; out.push(...arr); if (arr.length < 100) break; } return out; };
const pd = (d) => { const m = /\/Date\((\d+)/.exec(d || ""); return m ? new Date(Number(m[1])).toISOString().slice(0, 10) : String(d || "").slice(0, 10); };
const $ = (n) => Number(n || 0).toLocaleString("en-AU", { style: "currency", currency: "AUD" });
const since = (days) => new Date(Date.now() - days * 86400e3).toISOString().slice(0, 10);
const W = (s) => encodeURIComponent(s);

const accounts = ((await xeroGet("Accounts?where=" + W('Type=="BANK"')))?.Accounts ?? []).map((a) => ({ id: a.AccountID, code: a.Code, name: a.Name, status: a.Status, currency: a.CurrencyCode, bank: a.BankAccountNumber }));
const bills = (await pages("Invoices?where=" + W('Type=="ACCPAY" AND Status=="AUTHORISED" AND AmountDue>0') + "&order=DueDate", "Invoices")).map((i) => ({ id: i.InvoiceID, contact: i.Contact?.Name, number: i.InvoiceNumber, date: pd(i.Date), due: pd(i.DueDate), total: i.Total, amountDue: i.AmountDue, currency: i.CurrencyCode }));
const drafts = (await pages("Invoices?where=" + W('Type=="ACCPAY" AND Status=="DRAFT"') + "&order=Date", "Invoices")).map((i) => ({ id: i.InvoiceID, contact: i.Contact?.Name, number: i.InvoiceNumber, date: pd(i.Date), due: pd(i.DueDate), total: i.Total, lines: (i.LineItems || []).map((l) => ({ desc: l.Description?.slice(0, 60), acct: l.AccountCode, amt: l.LineAmount, tax: l.TaxType })) }));
const invoices = (await pages("Invoices?where=" + W(`Type=="ACCREC" AND Status=="AUTHORISED" AND AmountDue>0 AND Date>=DateTime(${since(120).replace(/-/g, ",")})`) + "&order=Date", "Invoices")).map((i) => ({ id: i.InvoiceID, contact: i.Contact?.Name, number: i.InvoiceNumber, date: pd(i.Date), due: pd(i.DueDate), total: i.Total, amountDue: i.AmountDue }));
const unrecTx = (await pages("BankTransactions?where=" + W('IsReconciled==false AND Status=="AUTHORISED"') + "&order=Date", "BankTransactions")).map((t) => ({ id: t.BankTransactionID, account: t.BankAccount?.Name, type: t.Type, date: pd(t.Date), contact: t.Contact?.Name, ref: t.Reference, total: t.Total, lines: (t.LineItems || []).map((l) => `${l.AccountCode} ${l.LineAmount}`).join("; ") }));
const unrecPay = (await pages("Payments?where=" + W('IsReconciled==false AND Status=="AUTHORISED"') + "&order=Date", "Payments")).map((p) => ({ id: p.PaymentID, account: p.Account?.Name || p.Account?.Code, date: pd(p.Date), amount: p.Amount, type: p.PaymentType, invoice: p.Invoice?.InvoiceNumber, contact: p.Invoice?.Contact?.Name, batch: p.BatchPaymentID || null }));
const batches = ((await xeroGet("BatchPayments?where=" + W(`Date>=DateTime(${since(45).replace(/-/g, ",")})`)))?.BatchPayments ?? []).map((b) => ({ id: b.BatchPaymentID, date: pd(b.Date), type: b.Type, status: b.Status, total: b.TotalAmount, reconciled: b.IsReconciled, account: b.Account?.Code, n: (b.Payments || []).length, ref: b.Reference }));

const out = { at: new Date().toISOString(), calls, dayLeft, accounts, bills, drafts, invoices, unrecTx, unrecPay, batches };
writeFileSync(new URL("./xero-rec-today.json", import.meta.url), JSON.stringify(out, null, 2));

console.log(`Xero calls ${calls}, day remaining ${dayLeft}\n`);
console.log("BANK ACCOUNTS:"); for (const a of accounts) console.log(`  ${a.code} ${a.name} [${a.status}${a.currency !== "AUD" ? " " + a.currency : ""}]`);
console.log(`\nBILLS AWAITING PAYMENT: ${bills.length}, ${$(bills.reduce((s, b) => s + b.amountDue, 0))}`); for (const b of bills) console.log(`  ${b.due} ${b.contact} ${b.number} ${$(b.amountDue)}${b.currency && b.currency !== "AUD" ? " " + b.currency : ""}`);
console.log(`\nDRAFT BILLS: ${drafts.length}`); for (const d of drafts) console.log(`  ${d.date} ${d.contact} ${d.number} ${$(d.total)} | ${d.lines.map((l) => l.acct || "?").join(",")}`);
console.log(`\nINVOICES AWAITING PAYMENT (last 120 d): ${invoices.length}, ${$(invoices.reduce((s, b) => s + b.amountDue, 0))}`);
const byAcct = {}; for (const t of unrecTx) (byAcct[t.account] ||= []).push(t);
console.log(`\nUNRECONCILED BANK TRANSACTIONS: ${unrecTx.length}`); for (const [a, rows] of Object.entries(byAcct)) { console.log(`  ${a}: ${rows.length}`); for (const t of rows) console.log(`    ${t.date} ${t.type} ${$(t.total)} ${t.contact || ""} ${t.ref || ""} [${t.lines}]`); }
const byPay = {}; for (const p of unrecPay) (byPay[p.account] ||= []).push(p);
console.log(`\nUNRECONCILED PAYMENTS: ${unrecPay.length}`); for (const [a, rows] of Object.entries(byPay)) { console.log(`  ${a}: ${rows.length}`); for (const p of rows) console.log(`    ${p.date} ${p.type} ${$(p.amount)} ${p.contact || ""} ${p.invoice || ""}${p.batch ? " batch " + p.batch.slice(0, 8) : ""}`); }
console.log(`\nBATCH PAYMENTS (45 d): ${batches.length}`); for (const b of batches) console.log(`  ${b.date} ${b.type} ${$(b.total)} ${b.n} items ${b.status} rec=${b.reconciled} ${b.ref || ""}`);
