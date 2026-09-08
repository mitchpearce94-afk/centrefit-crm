// READ-ONLY: how are wages bank lines coded?
// 1. Chart accounts matching wage/payroll/salary/super
// 2. Recent SPEND bank transactions ~ weekly wages amounts — their line coding
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
  if (!res.ok) { console.error(`[WARN] ${path.split("?")[0]}: ${res.status} ${text.slice(0, 120)}`); return null; }
  return data;
};
const pd = (d) => { const m = /\/Date\((\d+)/.exec(d); return m ? new Date(Number(m[1])).toISOString().slice(0, 10) : String(d).slice(0, 10); };

console.log("=== Wage/payroll/salary/super accounts in the chart ===");
const accts = (await get("Accounts"))?.Accounts ?? [];
for (const a of accts) {
  if (/wage|payroll|salar|super|paye/i.test(a.Name ?? "")) {
    console.log(`  code=${String(a.Code ?? "").padEnd(6)} type=${String(a.Type ?? "").padEnd(10)} class=${String(a.Class ?? "").padEnd(9)} ${a.Name}  (status=${a.Status})`);
  }
}

console.log("\n=== Recent SPEND lines that look like wages (Jul-Aug 2026) ===");
const bts = [];
for (let page = 1; page <= 5; page++) {
  const data = await get(`BankTransactions?where=${encodeURIComponent('Type=="SPEND" AND Date>=DateTime(2026,07,01)')}&order=Date DESC&page=${page}`);
  const arr = data?.BankTransactions ?? [];
  bts.push(...arr);
  if (arr.length < 100) break;
}
const wagey = bts.filter((t) => t.Status !== "DELETED" && (t.Total >= 4000 && t.Total <= 12000) && /centrefit|wage|pay/i.test(t.Contact?.Name ?? ""));
for (const t of wagey.slice(0, 10)) {
  const full = (await get(`BankTransactions/${t.BankTransactionID}`))?.BankTransactions?.[0];
  const lines = (full?.LineItems ?? []).map((l) => `${l.AccountCode}:${l.LineAmount}`).join(" + ");
  console.log(`  ${pd(t.Date)}  $${t.Total}  contact=${t.Contact?.Name}  rec=${t.IsReconciled}  lines=[${lines}]  tax=${full?.LineItems?.[0]?.TaxType}`);
}
if (!wagey.length) console.log("  none found in that window — wages lines may still be unreconciled (nothing created yet)");

console.log("\n=== Account names for the codes used above ===");
const codes = new Set();
for (const t of wagey.slice(0, 10)) {
  const full = (await get(`BankTransactions/${t.BankTransactionID}`))?.BankTransactions?.[0];
  for (const l of full?.LineItems ?? []) codes.add(String(l.AccountCode));
}
for (const c of codes) {
  const a = accts.find((x) => String(x.Code) === c);
  if (a) console.log(`  ${c} = ${a.Name} (${a.Type}/${a.Class})`);
}
