// READ-ONLY preflight for the 59k batch rebuild.
// Checks: lock dates, ANZ bank account, $33 DSTECH batch contents, DSTECH bills,
// both 449503 bills, Transport Direct INV-22790.
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
const pd = (d) => { const m = /\/Date\((\d+)/.exec(d); return m ? new Date(Number(m[1])).toISOString().slice(0, 16).replace("T", " ") : String(d).slice(0, 16); };
const money = (n) => Number(n).toLocaleString("en-AU", { style: "currency", currency: "AUD" });

console.log("=== 1. Organisation lock dates ===");
const org = (await xeroGet("Organisation"))?.Organisations?.[0];
console.log(`  PeriodLockDate=${org?.PeriodLockDate ? pd(org.PeriodLockDate).slice(0, 10) : "none"}  EndOfYearLockDate=${org?.EndOfYearLockDate ? pd(org.EndOfYearLockDate).slice(0, 10) : "none"}`);

console.log("\n=== 2. Bank accounts ===");
const accts = await xeroGet(`Accounts?where=${encodeURIComponent('Type=="BANK"')}`);
for (const a of accts?.Accounts ?? []) {
  console.log(`  code=${a.Code}  name=${a.Name}  id=${a.AccountID}  status=${a.Status}  ccy=${a.CurrencyCode}`);
}

console.log("\n=== 3. Amanda's $33 batch (d7bbfea2) contents ===");
const bp = (await xeroGet(`BatchPayments/d7bbfea2-475b-485b-89d1-a5a169607cb5`))?.BatchPayments?.[0];
console.log(`  status=${bp?.Status}  total=${money(bp?.TotalAmount ?? 0)}  date=${bp?.Date ? pd(bp.Date).slice(0, 10) : "?"}  rec=${bp?.IsReconciled}  account=${bp?.Account?.AccountID ?? "?"}`);
for (const p of bp?.Payments ?? []) {
  const full = (await xeroGet(`Payments/${p.PaymentID}`))?.Payments?.[0];
  console.log(`    payment ${p.PaymentID.slice(0, 8)}  ${money(full?.Amount ?? p.Amount ?? 0)}  status=${full?.Status}  inv=${full?.Invoice?.InvoiceNumber ?? "?"}  contact=${full?.Invoice?.Contact?.Name ?? "?"}  invId=${full?.Invoice?.InvoiceID ?? "?"}`);
}

console.log("\n=== 4. DSTECH bills ===");
for (const id of ["8a5d86ee-4fd5-4c77-96a2-b6ab95aec5d2", "228d44a3-8c97-4b12-b25b-73689456b527", "fd050393-20d1-4619-beca-2b1fbb21dd8b"]) {
  const inv = (await xeroGet(`Invoices/${id}`))?.Invoices?.[0];
  console.log(`  ${inv?.InvoiceNumber ?? "(no number)"}  status=${inv?.Status}  total=${money(inv?.Total ?? 0)}  due=${money(inv?.AmountDue ?? 0)}  paid=${money(inv?.AmountPaid ?? 0)}  payments=${(inv?.Payments ?? []).length}`);
}

console.log("\n=== 5. Both 449503 bills ===");
for (const [id, label] of [["eae2e0b0-61d7-49d3-86fc-23fcdf5df5c1", "22-May manual"], ["9348c7f3-7f1a-4cb1-b240-0514cdbb6763", "29-Jun email-to-bill twin"]]) {
  const inv = (await xeroGet(`Invoices/${id}`))?.Invoices?.[0];
  console.log(`  [${label}] num=${inv?.InvoiceNumber}  status=${inv?.Status}  date=${inv?.Date ? pd(inv.Date).slice(0, 10) : "?"}  total=${money(inv?.Total ?? 0)}  due=${money(inv?.AmountDue ?? 0)}  tax=${money(inv?.TotalTax ?? 0)}  payments=${(inv?.Payments ?? []).length}  creditNotes=${(inv?.CreditNotes ?? []).length}  lines=${(inv?.LineItems ?? []).length}`);
}

console.log("\n=== 6. Transport Direct INV-22790 (payment deleted 26 Aug) ===");
const td = await xeroGet(`Invoices?InvoiceNumbers=INV-22790`);
for (const inv of td?.Invoices ?? []) {
  console.log(`  ${inv.InvoiceNumber}  type=${inv.Type}  contact=${inv.Contact?.Name}  status=${inv.Status}  total=${money(inv.Total)}  due=${money(inv.AmountDue)}`);
}
