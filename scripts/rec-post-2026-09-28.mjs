// WRITES TO XERO when run with --post (dry run by default). Mitchell OK'd the 28 Sep 2026 rec sheet in chat ("ok for the rec").
// Pre-records the Xero side for the open 21–25 Sep statement lines so each is a green one-click match:
//   A approve 5 draft bills tied to lines · B invoice payments (customer receipts + GC matched items) in 602 · C GC fee spend to 446
//   D spend money for card/bank debits · E transfers 602→604 · F delete 3 stale Stripe fee lines · H bill payments for the approved drafts
// Everything is scoped to explicit IDs/amounts below. Output: console + scripts/rec-post-2026-09-28.json (what was created).
import { readFileSync, writeFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
const POST = process.argv.includes("--post");
const env = Object.fromEntries(readFileSync(new URL("../.env.gc-probe", import.meta.url), "utf8").split("\n").filter((l) => l.includes("=")).map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, "").replace(/\\r|\\n/g, "").replace(/\r|\n/g, "").trim()]; }));
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const { data: conn } = await sb.from("xero_connections").select("id, tenant_id, access_token, refresh_token, expires_at").order("updated_at", { ascending: false }).limit(1).single();
let at = conn.access_token;
if (!conn.expires_at || new Date(conn.expires_at).getTime() < Date.now() + 60_000) { const res = await fetch("https://identity.xero.com/connect/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", Authorization: "Basic " + Buffer.from(`${env.XERO_CLIENT_ID}:${env.XERO_CLIENT_SECRET}`).toString("base64") }, body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: conn.refresh_token }) }); const tok = await res.json(); if (!res.ok) { console.error("refresh failed", JSON.stringify(tok)); process.exit(1); } at = tok.access_token; await sb.from("xero_connections").update({ access_token: tok.access_token, refresh_token: tok.refresh_token ?? conn.refresh_token, expires_at: new Date(Date.now() + (tok.expires_in ?? 1800) * 1000).toISOString(), updated_at: new Date().toISOString() }).eq("id", conn.id); }
let calls = 0;
const xero = async (method, path, body) => { calls++; const r = await fetch(`https://api.xero.com/api.xro/2.0/${path}`, { method, headers: { Authorization: `Bearer ${at}`, "Xero-tenant-id": conn.tenant_id, Accept: "application/json", "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined }); const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch {} if (!r.ok) throw new Error(`${method} ${path.split("?")[0]} ${r.status}: ${t.slice(0, 300)}`); return j; };
const W = encodeURIComponent;
const T = JSON.parse(readFileSync(new URL("./xero-rec-today.json", import.meta.url), "utf8"));
const invByNo = Object.fromEntries(T.invoices.map((i) => [i.number, i]));
const acct602 = T.accounts.find((a) => a.code === "602").id, acct604 = T.accounts.find((a) => a.code === "604").id;
const log = []; const out = { at: new Date().toISOString(), posted: POST, created: [] };
const plan = (kind, desc, fn) => log.push({ kind, desc, fn });

// A. approve drafts (line description required by Xero on approval)
const drafts = [
  { id: "0d596e4d-0acf-4e82-abb6-038b2d97eec4", who: "Easther Electrical 00040769 $279.95", desc: "Easther Electrical invoice 00040769", code: "341", tax: "INPUT" },
  { id: "a273c2ae-fa54-4060-8dd4-ced79320711d", who: "Easther Electrical 00040765 $170.50", desc: "Easther Electrical invoice 00040765", code: "341", tax: "INPUT" },
  { id: "04f8dc34-f585-4cce-9dba-f5b6ea4c156d", who: "Virgin Australia $591.78", desc: "Virgin Australia flights", code: "493", tax: "INPUT" },
  { id: "68f37576-0dec-4f5e-b0b7-1881cdd4850d", who: "Uber $70.50", desc: "Uber trip", code: "493", tax: "INPUT" },
  { id: "77089713-5d13-4453-81fd-b3ae19ee8409", who: "Uber $67.41", desc: "Uber trip", code: "493", tax: "INPUT" },
];
for (const d of drafts) plan("A approve bill", `${d.who} → ${d.code} ${d.tax}`, async () => { const j = await xero("GET", `Invoices/${d.id}`); const inv = j.Invoices[0]; if (inv.Status !== "DRAFT") return `already ${inv.Status}`; const lines = inv.LineItems.map((l) => ({ ...l, Description: l.Description || d.desc, AccountCode: d.code, TaxType: d.tax })); await xero("POST", `Invoices/${d.id}`, { Invoices: [{ InvoiceID: d.id, Status: "AUTHORISED", LineItems: lines }] }); return "AUTHORISED"; });

// B. invoice payments in 602 (customer receipts on the statement + GC items the agent matched)
const pays = [
  ["2026-09-23", "INV-6790", 129], ["2026-09-23", "INV-6956", 71.5], ["2026-09-24", "INV-6931", 129], ["2026-09-24", "INV-6933", 129], ["2026-09-24", "INV-6968", 53.9],
  ["2026-09-25", "INV-6900", 27304.63], ["2026-09-25", "INV-6914", 21679.05],
  ["2026-09-23", "INV-6940", 249], ["2026-09-23", "INV-6917", 195.09], ["2026-09-23", "INV-6928", 139], ["2026-09-23", "INV-6938", 139], ["2026-09-23", "INV-6961", 129], ["2026-09-23", "INV-6963", 110], ["2026-09-23", "INV-6958", 60.5], ["2026-09-23", "INV-6957", 24.75],
  ["2026-09-24", "INV-6768", 60.5], ["2026-09-24", "INV-6769", 24.75], ["2026-09-25", "INV-6975", 139], ["2026-09-25", "INV-6977", 60.5],
];
for (const [date, no, amt] of pays) { const inv = invByNo[no]; if (!inv) { plan("B payment", `${date} ${no} $${amt} — NOT in awaiting list (paid already or older) → skip`, async () => "skipped"); continue; } if (Math.abs(inv.amountDue - amt) > 0.005) { plan("B payment", `${date} ${no} $${amt} — amount due is $${inv.amountDue} → skip, needs a look`, async () => "skipped"); continue; } plan("B payment", `${date} ${no} ${inv.contact} $${amt}`, async () => { const j = await xero("PUT", "Payments", { Payments: [{ Invoice: { InvoiceID: inv.id }, Account: { AccountID: acct602 }, Date: date, Amount: amt, Reference: `Bank rec 28 Sep` }] }); out.created.push({ kind: "payment", id: j.Payments[0].PaymentID, no, amt, date }); return j.Payments[0].PaymentID; }); }

// C. GoCardless fee spend money → 446 (GST on expenses, per finance_settings)
for (const [date, fee] of [["2026-09-23", 26.92], ["2026-09-24", 8.47], ["2026-09-25", 3.3]]) plan("C GC fee", `${date} GoCardless fee $${fee} → 446 INPUT`, async () => { const j = await xero("PUT", "BankTransactions", { BankTransactions: [{ Type: "SPEND", Contact: { ContactID: "e96836a3" .length === 8 ? undefined : undefined, Name: "GoCardless" }, Date: date, Reference: `GoCardless payout fee ${date}`, BankAccount: { AccountID: acct602 }, LineAmountTypes: "Inclusive", LineItems: [{ Description: `GoCardless fees, payout ${date}`, Quantity: 1, UnitAmount: fee, AccountCode: "446", TaxType: "INPUT" }] }] }); out.created.push({ kind: "spend", id: j.BankTransactions[0].BankTransactionID, desc: "GC fee", fee, date }); return j.BankTransactions[0].BankTransactionID; });

// D. spend money for card / bank debits with no bill
const spends = [
  ["2026-09-21", "Nissan Financial", 198.98, "843", "BASEXCLUDED", "Nissan Financial repayment"],
  ["2026-09-24", "Get Capital", 358.61, "840", "BASEXCLUDED", "Shift (Get Capital) chattel mortgage LPT-005273529"],
  ["2026-09-21", "Linkt", 100, "451", "INPUT", "Linkt tolls top-up"],
  ["2026-09-24", "Microsoft", 570.08, "485", "INPUT", "Microsoft 365 subscription"],
  ["2026-09-21", "Youi", 281.25, "449", "INPUT", "Youi premium"],
  ["2026-09-23", "Virgin Australia", 886.61, "493", "INPUT", "Virgin Australia flights"],
  ["2026-09-22", "Qantas Airways", 850.6, "493", "INPUT", "Qantas flights"],
  ["2026-09-25", "Jaycar", 14.95, "341", "INPUT", "Jaycar Strathpine"],
];
for (const [date, who, amt, code, tax, desc] of spends) plan("D spend", `${date} ${who} $${amt} → ${code} ${tax}`, async () => { const j = await xero("PUT", "BankTransactions", { BankTransactions: [{ Type: "SPEND", Contact: { Name: who }, Date: date, Reference: desc, BankAccount: { AccountID: acct602 }, LineAmountTypes: "Inclusive", LineItems: [{ Description: desc, Quantity: 1, UnitAmount: amt, AccountCode: code, TaxType: tax }] }] }); out.created.push({ kind: "spend", id: j.BankTransactions[0].BankTransactionID, who, amt, date }); return j.BankTransactions[0].BankTransactionID; });

// E. transfers 602 → 604 CF Technicians
for (const [date, amt] of [["2026-09-24", 1000], ["2026-09-25", 1500]]) plan("E transfer", `${date} $${amt} 602 → 604`, async () => { const j = await xero("PUT", "BankTransfers", { BankTransfers: [{ FromBankAccount: { AccountID: acct602 }, ToBankAccount: { AccountID: acct604 }, Amount: amt, Date: date }] }); out.created.push({ kind: "transfer", id: j.BankTransfers[0].BankTransferID, amt, date }); return j.BankTransfers[0].BankTransferID; });

// F. delete the 3 stale Stripe fee lines (Jul/Aug) that never matched a payout
for (const t of T.unrecTx.filter((t) => ["2026-07-02", "2026-07-03", "2026-08-25"].includes(t.date) && [4.95, 27.24, 6.71].includes(t.total))) plan("F delete", `${t.date} SPEND $${t.total} ${t.ref}`, async () => { await xero("POST", `BankTransactions/${t.id}`, { BankTransactions: [{ BankTransactionID: t.id, Status: "DELETED" }] }); out.created.push({ kind: "deleted", id: t.id, total: t.total, date: t.date }); return "DELETED"; });

// H. bill payments for the approved drafts, dated the statement lines
const billpays = [["2026-09-24", "0d596e4d-0acf-4e82-abb6-038b2d97eec4", 279.95, "Easther 00040769"], ["2026-09-24", "a273c2ae-fa54-4060-8dd4-ced79320711d", 170.5, "Easther 00040765"], ["2026-09-21", "04f8dc34-f585-4cce-9dba-f5b6ea4c156d", 591.78, "Virgin 591.78"], ["2026-09-25", "68f37576-0dec-4f5e-b0b7-1881cdd4850d", 70.5, "Uber 70.50"]];
for (const [date, id, amt, who] of billpays) plan("H bill payment", `${date} ${who} $${amt} from 602`, async () => { const j = await xero("PUT", "Payments", { Payments: [{ Invoice: { InvoiceID: id }, Account: { AccountID: acct602 }, Date: date, Amount: amt, Reference: "Bank rec 28 Sep" }] }); out.created.push({ kind: "billpayment", id: j.Payments[0].PaymentID, who, amt, date }); return j.Payments[0].PaymentID; });

console.log(`${POST ? "POSTING" : "DRY RUN"}: ${log.length} actions\n`);
let ok = 0, failed = 0;
for (const a of log) {
  if (!POST) { console.log(`  ${a.kind.padEnd(16)} ${a.desc}`); continue; }
  try { const r = await a.fn(); ok++; console.log(`  ✓ ${a.kind.padEnd(16)} ${a.desc} → ${r}`); } catch (e) { failed++; console.log(`  ✗ ${a.kind.padEnd(16)} ${a.desc} → ${e.message.slice(0, 220)}`); out.created.push({ kind: "FAILED", desc: a.desc, error: e.message.slice(0, 300) }); }
}
if (POST) { writeFileSync(new URL("./rec-post-2026-09-28.json", import.meta.url), JSON.stringify(out, null, 2)); console.log(`\nok ${ok}, failed ${failed}, Xero calls ${calls}`); await sb.from("finance_agent_actions").insert({ actor: "cortex", action: "bank_rec.pre_record", entity: "xero", entity_id: "602", after: { ok, failed, created: out.created.length }, rule: "Mitchell OK 28 Sep 14:20", note: "Pre-recorded payments/spends/transfers for the 21–25 Sep statement lines so they match green; drafts approved; stale Stripe fee lines deleted." }); }
