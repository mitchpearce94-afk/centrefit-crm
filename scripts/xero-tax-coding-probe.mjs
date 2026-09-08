// READ-ONLY: how are ATO/tax payments coded? Chart accounts + recent ATO spend lines.
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

console.log("=== Tax/GST/ATO/PAYG accounts in the chart ===");
const accts = (await get("Accounts"))?.Accounts ?? [];
for (const a of accts) {
  if (/gst|tax|ato|payg|integrated/i.test(a.Name ?? "") && a.Status === "ACTIVE") {
    console.log(`  code=${String(a.Code ?? "").padEnd(6)} type=${String(a.Type ?? "").padEnd(10)} class=${String(a.Class ?? "").padEnd(9)} ${a.Name}`);
  }
}

console.log("\n=== Recent SPEND lines to ATO-ish contacts (since May) ===");
const bts = [];
for (let page = 1; page <= 8; page++) {
  const data = await get(`BankTransactions?where=${encodeURIComponent('Type=="SPEND" AND Date>=DateTime(2026,05,01)')}&order=Date DESC&page=${page}`);
  const arr = data?.BankTransactions ?? [];
  bts.push(...arr);
  if (arr.length < 100) break;
}
const taxy = bts.filter((t) => t.Status !== "DELETED" && /ato|australian tax|deputy commissioner|tax office/i.test(t.Contact?.Name ?? ""));
for (const t of taxy.slice(0, 12)) {
  const full = (await get(`BankTransactions/${t.BankTransactionID}`))?.BankTransactions?.[0];
  const lines = (full?.LineItems ?? []).map((l) => `${l.AccountCode}:${l.LineAmount}:${l.TaxType}`).join(" + ");
  console.log(`  ${pd(t.Date)}  $${t.Total}  ${t.Contact?.Name}  rec=${t.IsReconciled}  [${lines}]`);
}
if (!taxy.length) console.log("  no ATO-contact spend lines found since May");

console.log("\n=== Transfers 602<->603 (GST holdings) since Jul ===");
const xfers = bts.filter((t) => t.Status !== "DELETED" && /transfer/i.test(t.Type ?? ""));
const all603 = [];
for (let page = 1; page <= 3; page++) {
  const data = await get(`BankTransactions?where=${encodeURIComponent('Date>=DateTime(2026,07,01)')}&order=Date DESC&page=${page}`);
  for (const t of data?.BankTransactions ?? []) {
    if ((t.Type ?? "").includes("TRANSFER") && t.Status !== "DELETED") all603.push(t);
  }
  if ((data?.BankTransactions ?? []).length < 100) break;
}
for (const t of all603.slice(0, 8)) console.log(`  ${pd(t.Date)}  $${t.Total}  type=${t.Type}  acct=${t.BankAccount?.Name}  rec=${t.IsReconciled}`);
