// READ-ONLY: the $842.87 intl transfer (13 Aug, Mark, wrong account number, now refunded).
// What exists in Xero for 842.87? Spend/receive transactions, payments, suspense accounts,
// and the current state of the Tuda + Chengdu bills.
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const env = Object.fromEntries(
  readFileSync(new URL("../.env.gc-probe", import.meta.url), "utf8")
    .split("\n").filter((l) => l.includes("="))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, "").replace(/\\r|\\n/g, "").replace(/\r|\n/g, "").trim()];
    }),
);
const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const { data: conn } = await supabase.from("xero_connections")
  .select("tenant_id, access_token").order("updated_at", { ascending: false }).limit(1).single();

const hdrs = { Authorization: `Bearer ${conn.access_token}`, "Xero-tenant-id": conn.tenant_id, Accept: "application/json" };
const get = async (path) => {
  const res = await fetch(`https://api.xero.com/api.xro/2.0/${path}`, { headers: hdrs });
  const text = await res.text();
  let data = null; try { data = JSON.parse(text); } catch {}
  if (!res.ok) { console.error(`[WARN] ${path.split("?")[0]}: ${res.status}`); return null; }
  return data;
};
const pd = (d) => { const m = /\/Date\((\d+)/.exec(d); return m ? new Date(Number(m[1])).toISOString().slice(0, 10) : String(d).slice(0, 10); };

console.log("=== Bank transactions of exactly 842.87 (any type/date) ===");
const bt = await get(`BankTransactions?where=${encodeURIComponent("Total==842.87")}`);
for (const t of bt?.BankTransactions ?? []) {
  const full = (await get(`BankTransactions/${t.BankTransactionID}`))?.BankTransactions?.[0];
  const lines = (full?.LineItems ?? []).map((l) => `${l.AccountCode}:${l.TaxType}`).join("+");
  console.log(`  ${pd(t.Date)}  type=${t.Type}  status=${t.Status}  rec=${t.IsReconciled}  contact=${t.Contact?.Name ?? "-"}  acct=${t.BankAccount?.Name}  [${lines}]  id=${t.BankTransactionID}`);
}
if (!(bt?.BankTransactions ?? []).length) console.log("  none — the outgoing feed line was never coded (still unreconciled)");

console.log("\n=== Payments of exactly 842.87 ===");
const pays = await get(`Payments?where=${encodeURIComponent("Amount==842.87")}`);
for (const p of pays?.Payments ?? []) {
  console.log(`  ${pd(p.Date)}  status=${p.Status}  rec=${p.IsReconciled}  inv=${p.Invoice?.InvoiceNumber}  ${p.Invoice?.Contact?.Name ?? ""}`);
}
if (!(pays?.Payments ?? []).length) console.log("  none");

console.log("\n=== Suspense/clearing accounts in chart ===");
const accts = (await get("Accounts"))?.Accounts ?? [];
for (const a of accts) {
  if (/suspense|clearing/i.test(a.Name ?? "") && a.Status === "ACTIVE") {
    console.log(`  code=${String(a.Code ?? "").padEnd(6)} type=${a.Type}  ${a.Name}  (EnablePaymentsToAccount=${a.EnablePaymentsToAccount ?? "?"})`);
  }
}

console.log("\n=== Tuda + Chengdu bills now ===");
for (const num of ["MY06001315AU4", "AU030402026081000000672"]) {
  const inv = (await get(`Invoices?InvoiceNumbers=${encodeURIComponent(num)}`))?.Invoices?.[0];
  if (inv) console.log(`  ${inv.InvoiceNumber}  ${inv.Contact?.Name}  status=${inv.Status}  total=${inv.Total}  due=${inv.AmountDue}  ccy=${inv.CurrencyCode}`);
}
