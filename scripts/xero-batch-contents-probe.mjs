// READ-ONLY: group all AUTHORISED payments Jun-Jul 2026 by BatchPaymentID,
// sum each batch, list members — find what the 2 Jul $21,814.53 lump contains.
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
  if (!res.ok) { console.error(`[WARN] ${path.split("?")[0]}:`, res.status, text.slice(0, 120)); return null; }
  return data;
};
const pd = (d) => { const m = /\/Date\((\d+)/.exec(d); return m ? new Date(Number(m[1])).toISOString().slice(0, 10) : String(d).slice(0, 10); };
const money = (n) => (n ?? 0).toLocaleString("en-AU", { style: "currency", currency: "AUD" });

const pays = [];
for (let page = 1; ; page++) {
  const where = encodeURIComponent('Status=="AUTHORISED" AND PaymentType=="ACCPAYPAYMENT" AND Date>=DateTime(2026,06,15) AND Date<=DateTime(2026,07,10)');
  const data = await xeroGet(`Payments?where=${where}&order=Date&page=${page}`);
  if (!data) break;
  const batch = data.Payments ?? [];
  pays.push(...batch);
  if (batch.length < 100) break;
}

const byBatch = {};
const loose = [];
for (const p of pays) {
  const bid = p.BatchPayment?.BatchPaymentID;
  if (bid) (byBatch[bid] ??= []).push(p);
  else loose.push(p);
}
console.log(`Payments 15 Jun - 10 Jul: ${pays.length}  (batches: ${Object.keys(byBatch).length}, loose: ${loose.length})`);
for (const [bid, list] of Object.entries(byBatch).sort((a, b) => sumOf(b[1]) - sumOf(a[1]))) {
  console.log(`\nBATCH ${bid.slice(0, 8)}…  total ${money(sumOf(list))}  (${list.length} payments, dated ${pd(list[0].Date)})`);
  for (const p of list) {
    console.log(`  ${pd(p.Date)}  ${money(p.Amount).padStart(12)}  rec=${p.IsReconciled ? "Y" : "N"}  ${(p.Invoice?.Contact?.Name ?? "?").slice(0, 38).padEnd(40)} ${p.Invoice?.InvoiceNumber ?? ""}`);
  }
}
function sumOf(list) { return list.reduce((s, p) => s + (p.Amount ?? 0), 0); }
console.log("\nLOOSE (non-batch) payments in window:");
for (const p of loose) console.log(`  ${pd(p.Date)}  ${money(p.Amount).padStart(12)}  rec=${p.IsReconciled ? "Y" : "N"}  ${(p.Invoice?.Contact?.Name ?? "?").slice(0, 38).padEnd(40)} ${p.Invoice?.InvoiceNumber ?? ""}`);
