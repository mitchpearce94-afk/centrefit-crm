// READ-ONLY: paged tally of all live 30-Jun payments with the 600855 rebuild ref
// + reconciliation status of each piece + the two overpayments.
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
  if (!res.ok) console.error(`[WARN] ${path.split("?")[0]}: ${res.status}`);
  return data;
};

const all = [];
for (let page = 1; page <= 20; page++) {
  const data = await get(`Payments?where=${encodeURIComponent('Status=="AUTHORISED" AND Date==DateTime(2026,06,30)')}&order=UpdatedDateUTC&page=${page}`);
  const arr = data?.Payments ?? [];
  all.push(...arr);
  if (arr.length < 100) break;
}
console.log(`live payments dated 30 Jun 2026: ${all.length}`);
const mine = all.filter((x) => (x.Reference ?? "").includes("600855"));
let sum = 0;
for (const p of mine) {
  sum += p.Amount;
  console.log(`  ${String(p.Amount).padStart(10)}  ${(p.Invoice?.InvoiceNumber ?? "?").padEnd(14)} ${(p.Invoice?.Contact?.Name ?? "?").slice(0, 32)}  rec=${p.IsReconciled}`);
}
console.log(`600855-ref payments: ${mine.length}, sum=${sum.toFixed(2)}`);

for (const [id, label] of [["76da0dca-296d-4b5e-8ec7-585a325c6425", "EC overpayment 14,130.67"], ["5d7d9185-c29d-42c4-af29-fbc712798a86", "DSTECH overpayment 41.25"]]) {
  const t = (await get(`BankTransactions/${id}`))?.BankTransactions?.[0];
  console.log(`${label}: status=${t?.Status}  rec=${t?.IsReconciled}`);
}
console.log(`\nGRAND TOTAL live pieces: ${(sum + 14130.67 + 41.25).toFixed(2)} (target 59053.52)`);
