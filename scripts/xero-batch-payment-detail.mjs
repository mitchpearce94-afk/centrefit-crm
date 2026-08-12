// READ-ONLY follow-up: group the unreconciled payments by BatchPayment and
// dump the raw BatchPayment metadata (date, total, status) so each batch's
// expected bank-line amount is known. Only fetches July 2026 onward.
import { readFileSync, writeFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const env = Object.fromEntries(
  readFileSync(new URL("../.env.gc-probe", import.meta.url), "utf8")
    .split("\n").filter((l) => l.includes("="))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, "").replace(/\\r|\\n/g, "").trim()];
    }),
);
const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const { data: conn } = await supabase
  .from("xero_connections")
  .select("id, tenant_id, access_token, refresh_token, expires_at")
  .order("updated_at", { ascending: false })
  .limit(1)
  .single();

const accessToken = conn.access_token; // fresh from previous run

const xeroGet = async (path) => {
  const res = await fetch(`https://api.xero.com/api.xro/2.0/${path}`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Xero-tenant-id": conn.tenant_id,
      Accept: "application/json",
    },
  });
  const data = await res.json();
  if (!res.ok) { console.error(`${path} failed:`, res.status, JSON.stringify(data).slice(0, 400)); process.exit(1); }
  return data;
};

const parseXeroDate = (d) => {
  if (!d) return null;
  const m = /\/Date\((\d+)/.exec(d);
  return m ? new Date(Number(m[1])).toISOString().slice(0, 10) : String(d).slice(0, 10);
};

const all = [];
for (let page = 1; ; page++) {
  const where = encodeURIComponent('Status=="AUTHORISED" AND Date>=DateTime(2026,07,01)');
  const data = await xeroGet(`Payments?where=${where}&order=Date&page=${page}`);
  const batch = data.Payments ?? [];
  all.push(...batch);
  if (batch.length < 100) break;
}

const unrec = all.filter((p) => p.IsReconciled === false);
writeFileSync(new URL("./xero-unrec-raw.json", import.meta.url), JSON.stringify(unrec, null, 2));

const money = (n) => Number(n).toLocaleString("en-AU", { style: "currency", currency: "AUD" });

const batches = {};
const loose = [];
for (const p of unrec) {
  const bp = p.BatchPayment;
  if (bp?.BatchPaymentID) (batches[bp.BatchPaymentID] ??= { meta: bp, payments: [] }).payments.push(p);
  else loose.push(p);
}

console.log(`Unreconciled payments since 2026-07-01: ${unrec.length}`);
console.log(`Distinct batch payments involved: ${Object.keys(batches).length}\n`);

console.log("=== Batches (what to look for in the bank statement) ===");
for (const [id, { meta, payments }] of Object.entries(batches).sort((a, b) =>
  parseXeroDate(a[1].meta.Date ?? "")?.localeCompare(parseXeroDate(b[1].meta.Date ?? "") ?? "") ?? 0)) {
  const sum = payments.reduce((s, p) => s + (p.Amount ?? 0), 0);
  console.log(`Batch ${id}`);
  console.log(`  date=${parseXeroDate(meta.Date)}  status=${meta.Status ?? "?"}  batchTotal=${meta.TotalAmount != null ? money(meta.TotalAmount) : "?"}  reconciled=${meta.IsReconciled ?? "?"}  type=${meta.Type ?? "?"}`);
  console.log(`  unreconciled payments in this batch: ${payments.length} = ${money(sum)}`);
  for (const p of payments) {
    console.log(`    ${parseXeroDate(p.Date)}  ${money(p.Amount).padStart(12)}  ${(p.Invoice?.InvoiceNumber ?? "?").padEnd(14)} ${(p.Invoice?.Contact?.Name ?? "?").slice(0, 40)}`);
  }
  console.log("");
}

if (loose.length) {
  console.log("=== Non-batch unreconciled payments ===");
  for (const p of loose) {
    console.log(`${parseXeroDate(p.Date)}  ${money(p.Amount).padStart(12)}  ${(p.Invoice?.InvoiceNumber ?? "?").padEnd(14)} ${(p.Invoice?.Contact?.Name ?? "?").slice(0, 40)}  ref=${p.Reference ?? ""}`);
  }
}
