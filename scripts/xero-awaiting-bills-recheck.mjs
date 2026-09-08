// READ-ONLY: post-rebuild recheck of the 25-Aug awaiting-bills audit items.
// 1. All ACCPAY bills awaiting payment (full current list)
// 2. Leader V-SI-3800026 duplicate pair
// 3. 25-Aug batch 0cc3cdea status + contents (Electrocraft never-pay violation)
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
  .select("id, tenant_id, access_token, refresh_token, expires_at")
  .order("updated_at", { ascending: false }).limit(1).single();

let accessToken = conn.access_token;
if (!conn.expires_at || new Date(conn.expires_at).getTime() < Date.now() + 60_000) {
  const res = await fetch("https://identity.xero.com/connect/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: "Basic " + Buffer.from(`${env.XERO_CLIENT_ID}:${env.XERO_CLIENT_SECRET}`).toString("base64"),
    },
    body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: conn.refresh_token }),
  });
  const tok = await res.json();
  if (!res.ok) { console.error("refresh failed", JSON.stringify(tok)); process.exit(1); }
  accessToken = tok.access_token;
  await supabase.from("xero_connections").update({
    access_token: tok.access_token,
    refresh_token: tok.refresh_token ?? conn.refresh_token,
    expires_at: new Date(Date.now() + (tok.expires_in ?? 1800) * 1000).toISOString(),
    updated_at: new Date().toISOString(),
  }).eq("id", conn.id);
}

const xeroGet = async (path) => {
  const res = await fetch(`https://api.xero.com/api.xro/2.0/${path}`, {
    headers: { Authorization: `Bearer ${accessToken}`, "Xero-tenant-id": conn.tenant_id, Accept: "application/json" },
  });
  const text = await res.text();
  let data = null; try { data = JSON.parse(text); } catch {}
  if (!res.ok) { console.error(`[WARN] ${path.split("?")[0]}:`, res.status, text.slice(0, 150)); return null; }
  return data;
};
const pd = (d) => { const m = /\/Date\((\d+)/.exec(d); return m ? new Date(Number(m[1])).toISOString().slice(0, 10) : String(d).slice(0, 10); };
const money = (n) => Number(n).toLocaleString("en-AU", { style: "currency", currency: "AUD" });

console.log("=== 1. ALL bills awaiting payment (ACCPAY, AUTHORISED, due>0) ===");
const bills = [];
for (let page = 1; ; page++) {
  const data = await xeroGet(`Invoices?where=${encodeURIComponent('Type=="ACCPAY" AND Status=="AUTHORISED" AND AmountDue>0')}&order=DueDate&page=${page}`);
  const arr = data?.Invoices ?? [];
  bills.push(...arr);
  if (arr.length < 100) break;
}
let total = 0;
for (const b of bills) {
  total += b.AmountDue;
  console.log(`  due=${pd(b.DueDate)}  ${money(b.AmountDue).padStart(12)}  ${(b.InvoiceNumber ?? "(no num)").padEnd(18)} ${(b.Contact?.Name ?? "?").slice(0, 40)}  id=${b.InvoiceID}`);
}
console.log(`  TOTAL: ${bills.length} bills, ${money(total)}`);

console.log("\n=== 2. Leader V-SI-3800026 duplicate pair ===");
const leader = await xeroGet(`Invoices?InvoiceNumbers=V-SI-3800026`);
for (const b of leader?.Invoices ?? []) {
  console.log(`  ${b.InvoiceNumber}  status=${b.Status}  date=${pd(b.Date)}  total=${money(b.Total)}  due=${money(b.AmountDue)}  paid=${money(b.AmountPaid)}  updated=${pd(b.UpdatedDateUTC)}  id=${b.InvoiceID}`);
}

console.log("\n=== 3. 25-Aug batch 0cc3cdea ===");
const bps = await xeroGet(`BatchPayments`);
const aug25 = (bps?.BatchPayments ?? []).filter((b) => b.BatchPaymentID.startsWith("0cc3cdea"));
for (const b of aug25) {
  console.log(`  ${pd(b.Date)}  ${money(b.TotalAmount ?? 0)}  status=${b.Status}  reconciled=${b.IsReconciled}  id=${b.BatchPaymentID}`);
  const full = (await xeroGet(`BatchPayments/${b.BatchPaymentID}`))?.BatchPayments?.[0];
  for (const p of full?.Payments ?? []) {
    const fp = (await xeroGet(`Payments/${p.PaymentID}`))?.Payments?.[0];
    console.log(`    ${money(fp?.Amount ?? p.Amount ?? 0).padStart(12)}  ${(fp?.Invoice?.InvoiceNumber ?? "?").padEnd(16)} ${(fp?.Invoice?.Contact?.Name ?? "?").slice(0, 35)}  payStatus=${fp?.Status}  rec=${fp?.IsReconciled}`);
  }
}
if (!aug25.length) console.log("  batch 0cc3cdea not found in list");
