// WRITES with --post. Mitchell 6 Oct (in flight): tech card 604 3–17 Sep leftovers + CF Solutions 607 11 Sep–5 Oct.
// Lines Xero already pre-fills via bank rules are NOT posted (Ness 50.27, 7-Eleven 170.03 + 101.06, Jaycar 49.95 on 604; Google Workspace 88.26 on 607) — Mitchell clicks OK.
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
const POST = process.argv.includes("--post");
const env = Object.fromEntries(readFileSync(new URL("../.env.gc-probe", import.meta.url), "utf8").split("\n").filter((l) => l.includes("=") && !l.startsWith("#")).map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, "").replace(/\\n$/, "")]; }));
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const { data: conn } = await sb.from("xero_connections").select("tenant_id, access_token").order("updated_at", { ascending: false }).limit(1).single();
const H = { Authorization: "Bearer " + conn.access_token, "Xero-tenant-id": conn.tenant_id, Accept: "application/json", "Content-Type": "application/json" };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms)); let calls = 0;
const xero = async (m, p, b, attempt = 0) => { await sleep(1100); calls++; const r = await fetch("https://api.xero.com/api.xro/2.0/" + p, { method: m, headers: H, body: b ? JSON.stringify(b) : undefined }); const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch {} if (r.status === 429 && attempt < 3) { await sleep(61000); return xero(m, p, b, attempt + 1); } if (!r.ok) throw new Error(m + " " + p + " " + r.status + ": " + (j?.Elements?.[0]?.ValidationErrors?.map((e) => e.Message).join("; ") || t).slice(0, 250)); return j; };
const T = JSON.parse(readFileSync(new URL("./xero-rec-today.json", import.meta.url), "utf8")); const A604 = T.accounts.find((a) => a.code === "604").id, A607 = T.accounts.find((a) => a.code === "607").id;
const log = []; const plan = (kind, desc, fn) => log.push({ kind, desc, fn });

const spend = (acctId, acctCode, rows) => { for (const [date, who, amt, code, tax, desc] of rows) plan("spend " + acctCode, `${date} ${who} $${amt} → ${code} ${tax}`, async () => {
  const j = await xero("GET", `BankTransactions?where=${encodeURIComponent(`BankAccount.Code=="${acctCode}" AND Type=="SPEND" AND Status!="DELETED" AND Date==DateTime(${date.replace(/-/g, ",")})`)}`);
  if (j.BankTransactions.some((b) => Math.abs(Number(b.Total) - amt) < 0.005)) return "a spend for this amount already exists that day → skip";
  if (!POST) return "would spend";
  const r = await xero("PUT", "BankTransactions", { BankTransactions: [{ Type: "SPEND", Contact: { Name: who }, Date: date, Reference: desc, BankAccount: { AccountID: acctId }, LineAmountTypes: "Inclusive", LineItems: [{ Description: desc, Quantity: 1, UnitAmount: amt, AccountCode: code, TaxType: tax }] }] });
  return r.BankTransactions[0].BankTransactionID;
}); };

// 604 — tech card, 3–17 Sep
spend(A604, "604", [
  ["2026-09-03", "Stonegate International", 100, "341", "INPUT", "Stonegate International Archerfield"],
  ["2026-09-03", "Leader Computers Pty Ltd", 221.09, "341", "INPUT", "Leader Computers — card purchase 3 Sep"],
  ["2026-09-11", "Officeworks", 61.5, "461", "INPUT", "Officeworks Warana"],
  ["2026-09-11", "Planar Restaurant", 87.67, "306", "INPUT", "Planar Restaurant Darling Harbour — meal, Sydney trip"],
  ["2026-09-14", "ICC Sydney", 4.8, "306", "INPUT", "ICC Sydney — refreshment"],
  ["2026-09-15", "Anthropic", 340, "485", "BASEXCLUDED", "Anthropic Claude subscription (overseas, no GST)"],
  ["2026-09-15", "Reddy Express", 73.29, "447", "INPUT", "Reddy Express Bulimba — fuel"],
  ["2026-09-17", "BP", 80.01, "447", "INPUT", "BP Kallangur — fuel"],
]);

// 607 — CF Solutions, 11 Sep–5 Oct
spend(A607, "607", [
  ["2026-09-11", "Alibaba", 80.09, "341", "BASEXCLUDED", "Alibaba.com Singapore — parts (overseas, no GST)"],
  ["2026-09-14", "Tradify", 40, "485", "INPUT", "Tradify subscription"],
  ["2026-09-14", "Digi-Key", 53.94, "341", "BASEXCLUDED", "Digi-Key — USD 37.74 incl. overseas fee (no GST)"],
  ["2026-09-21", "Ezi Licences 4 Work", 463.76, "474", "INPUT", "Licences 4 Work Bankstown — licence / training"],
  ["2026-09-28", "Amazon", 40.05, "341", "INPUT", "Amazon Marketplace AU"],
  ["2026-09-28", "Amazon", 44.4, "341", "INPUT", "Amazon Marketplace AU"],
  ["2026-09-28", "Dropbox", 184.67, "485", "INPUT", "Dropbox subscription"],
  ["2026-09-28", "DJ City", 3950, "341", "INPUT", "DJ City — EFTPOS 28 Sep (no invoice in Xero yet)"],
  ["2026-09-29", "Amazon", 23.66, "341", "INPUT", "Amazon Marketplace AU"],
  ["2026-09-30", "Australia Post", 22.95, "462", "INPUT", "Australia Post — postage"],
  ["2026-10-02", "Australia Post", 22.95, "462", "INPUT", "Australia Post — postage"],
]);

// 607 — two drafts that ARE the receipts
plan("draft→bill 607", "Officeworks $39 (was 'No Contact 1832840428') → 461, pay 1 Oct", async () => {
  const id = "8cb9b754-33d5-4543-9829-6d95e25d04fb"; const inv = (await xero("GET", `Invoices/${id}`)).Invoices[0];
  if (inv.Status === "PAID") return "already PAID → skip"; if (!POST) return `would fix+approve+pay (status ${inv.Status})`;
  if (inv.Status === "DRAFT") await xero("POST", `Invoices/${id}`, { Invoices: [{ InvoiceID: id, Status: "AUTHORISED", Contact: { Name: "Officeworks" }, Date: "2026-10-01", DueDate: "2026-10-01", LineItems: inv.LineItems.map((l) => ({ ...l, Description: l.Description || "Officeworks Bentleigh East 1832840428", AccountCode: "461", TaxType: "INPUT" })) }] });
  const p = await xero("PUT", "Payments", { Payments: [{ Invoice: { InvoiceID: id }, Account: { AccountID: A607 }, Date: "2026-10-01", Amount: 39, Reference: "Bank rec 6 Oct" }] }); return "approved + paid " + p.Payments[0].PaymentID;
});
plan("draft→bill 607", "X On Electrical $116.56 (draft dated 2020-10-01 → 2026-10-05) → 341, pay 5 Oct", async () => {
  const j = await xero("GET", `Invoices?where=${encodeURIComponent('Type=="ACCPAY" AND Status=="DRAFT" AND Total==116.56')}`); const inv = j.Invoices[0];
  if (!inv) return "no draft for $116.56 found (already handled?) → skip"; if (!POST) return `would fix date/contact, approve, pay (contact now '${inv.Contact?.Name}')`;
  const full = (await xero("GET", `Invoices/${inv.InvoiceID}`)).Invoices[0];
  await xero("POST", `Invoices/${inv.InvoiceID}`, { Invoices: [{ InvoiceID: inv.InvoiceID, Status: "AUTHORISED", Contact: { Name: "X On Electrical Services" }, Date: "2026-10-05", DueDate: "2026-10-05", LineItems: full.LineItems.map((l) => ({ ...l, Description: l.Description || "X On Electrical Services Bentley", AccountCode: "341", TaxType: "INPUT" })) }] });
  const p = await xero("PUT", "Payments", { Payments: [{ Invoice: { InvoiceID: inv.InvoiceID }, Account: { AccountID: A607 }, Date: "2026-10-05", Amount: 116.56, Reference: "Bank rec 6 Oct" }] }); return "approved + paid " + p.Payments[0].PaymentID;
});

console.log(`${POST ? "POSTING" : "DRY RUN"}: ${log.length} actions`); let ok = 0, skipped = 0, failed = 0;
for (const a of log) { try { const r = await a.fn(); if (/skip/.test(String(r))) skipped++; else ok++; console.log(`  ${a.kind.padEnd(16)} ${a.desc} → ${r}`); } catch (e) { failed++; console.log(`  ✗ ${a.kind.padEnd(16)} ${a.desc} → ${e.message}`); } }
console.log(`\n${POST ? "posted" : "dry run"}: ok ${ok}, skipped ${skipped}, failed ${failed}, calls ${calls}`);
if (POST) await sb.from("finance_agent_actions").insert({ actor: "cortex", action: "bank_rec.pre_record", entity: "xero", entity_id: "604+607", after: { ok, skipped, failed }, rule: "Mitchell OK 6 Oct ('same same for solutions', tech from 3 Sep)", note: "rec-post-2026-10-06-604-607.mjs" });
