// WRITES: GoCardless payout 28 Sep 2026 (net 577.99 = Tuggerah INV-6976 235.25 + Vermont South 350.87 − fee 8.13).
// Vermont South INV-6041 only has 52.89 due → 52.89 payment + 297.98 OVERPAYMENT (credit on the contact, Mitchell decides refund/apply).
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
const POST = process.argv.includes("--post");
const env = Object.fromEntries(readFileSync(new URL("../.env.gc-probe", import.meta.url), "utf8").split("\n").filter((l) => l.includes("=") && !l.startsWith("#")).map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, "").replace(/\\n$/, "")]; }));
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const { data: conn } = await sb.from("xero_connections").select("tenant_id, access_token").order("updated_at", { ascending: false }).limit(1).single();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const xero = async (m, p, b) => { await sleep(1100); const r = await fetch("https://api.xero.com/api.xro/2.0/" + p, { method: m, headers: { Authorization: `Bearer ${conn.access_token}`, "Xero-tenant-id": conn.tenant_id, Accept: "application/json", "Content-Type": "application/json" }, body: b ? JSON.stringify(b) : undefined }); const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch {} if (!r.ok) throw new Error(`${m} ${p} ${r.status}: ${(j?.Elements?.[0]?.ValidationErrors?.map((e) => e.Message).join("; ") || t).slice(0, 300)}`); return j; };
const A602 = JSON.parse(readFileSync(new URL("./xero-rec-today.json", import.meta.url), "utf8")).accounts.find((a) => a.code === "602").id;
const D = "2026-09-28";
const tug = (await xero("GET", "Invoices/INV-6976")).Invoices[0]; const vs = (await xero("GET", "Invoices/INV-6041")).Invoices[0];
console.log(`INV-6976 ${tug.Contact.Name} due ${tug.AmountDue} ${tug.Status} | INV-6041 ${vs.Contact.Name} due ${vs.AmountDue} ${vs.Status}`);
if (tug.Status === "PAID" || vs.Status === "PAID") { console.log("already paid → stop"); process.exit(0); }
if (Math.abs(tug.AmountDue - 235.25) > 0.005 || Math.abs(vs.AmountDue - 52.89) > 0.005) { console.log("amounts moved → stop"); process.exit(1); }
if (!POST) { console.log("DRY RUN ok: would post payment 235.25 (INV-6976), payment 52.89 (INV-6041), overpayment 297.98 (Vermont South), fee spend 8.13 → 446"); process.exit(0); }
const p1 = await xero("PUT", "Payments", { Payments: [{ Invoice: { InvoiceID: tug.InvoiceID }, Account: { AccountID: A602 }, Date: D, Amount: 235.25, Reference: "GoCardless payout 2026-09-28" }] });
const p2 = await xero("PUT", "Payments", { Payments: [{ Invoice: { InvoiceID: vs.InvoiceID }, Account: { AccountID: A602 }, Date: D, Amount: 52.89, Reference: "GoCardless payout 2026-09-28 — instalment 4/4 part" }] });
const op = await xero("PUT", "BankTransactions", { BankTransactions: [{ Type: "RECEIVE-OVERPAYMENT", Contact: { ContactID: vs.Contact.ContactID }, Date: D, Reference: "GoCardless payout 2026-09-28 — Vermont South instalment 4/4 over-collection (4 × $350.87 vs INV-6041 $1,105.50)", BankAccount: { AccountID: A602 }, LineAmountTypes: "NoTax", LineItems: [{ Description: "Overpayment — Vermont South duress intercom instalment 4/4", Quantity: 1, UnitAmount: 297.98 }] }] });
const fee = await xero("PUT", "BankTransactions", { BankTransactions: [{ Type: "SPEND", Contact: { Name: "GoCardless" }, Date: D, Reference: "GoCardless payout fee 2026-09-28", BankAccount: { AccountID: A602 }, LineAmountTypes: "Inclusive", LineItems: [{ Description: "GoCardless fees on payout 2026-09-28", Quantity: 1, UnitAmount: 8.13, AccountCode: "446", TaxType: "INPUT" }] }] });
console.log("posted:", p1.Payments[0].PaymentID, p2.Payments[0].PaymentID, op.BankTransactions[0].BankTransactionID, fee.BankTransactions[0].BankTransactionID);
