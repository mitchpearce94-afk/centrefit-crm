// READ-ONLY: after Amanda deleted the 59k batch on 26 Aug — did she rebuild anything?
// Checks: spend-money BankTransactions ~59,053.52, Electrocraft overpayments/prepayments,
// any new batch payments dated 30 Jun, and other payments DELETED on 25-26 Aug (blast radius).
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

console.log("=== A. Spend-money bank transactions 59,053.52 (any date) ===");
const bt = await xeroGet(`BankTransactions?where=${encodeURIComponent('Total==59053.52')}`);
for (const t of bt?.BankTransactions ?? []) {
  console.log(`  ${pd(t.Date).slice(0, 10)}  type=${t.Type}  status=${t.Status}  rec=${t.IsReconciled}  contact=${t.Contact?.Name ?? "?"}  id=${t.BankTransactionID}`);
}
if (!(bt?.BankTransactions ?? []).length) console.log("  none");

console.log("\n=== B. Electrocraft overpayments/prepayments/credit notes ===");
const ec = await xeroGet(`Contacts?where=${encodeURIComponent('Name.Contains("Electrocraft")')}`);
for (const c of ec?.Contacts ?? []) {
  console.log(`  contact: ${c.Name}  id=${c.ContactID}`);
  const ops = await xeroGet(`Overpayments?where=${encodeURIComponent(`Contact.ContactID==Guid("${c.ContactID}")`)}`);
  for (const o of ops?.Overpayments ?? []) console.log(`    OVERPAYMENT ${pd(o.Date).slice(0, 10)}  ${money(o.Total)}  status=${o.Status}  remaining=${money(o.RemainingCredit ?? 0)}`);
  if (!(ops?.Overpayments ?? []).length) console.log("    no overpayments");
  const pps = await xeroGet(`Prepayments?where=${encodeURIComponent(`Contact.ContactID==Guid("${c.ContactID}")`)}`);
  for (const o of pps?.Prepayments ?? []) console.log(`    PREPAYMENT ${pd(o.Date).slice(0, 10)}  ${money(o.Total)}  status=${o.Status}  remaining=${money(o.RemainingCredit ?? 0)}`);
  if (!(pps?.Prepayments ?? []).length) console.log("    no prepayments");
  const cns = await xeroGet(`CreditNotes?where=${encodeURIComponent(`Contact.ContactID==Guid("${c.ContactID}")`)}`);
  for (const o of cns?.CreditNotes ?? []) console.log(`    CREDIT NOTE ${o.CreditNoteNumber ?? ""}  ${pd(o.Date).slice(0, 10)}  ${money(o.Total)}  status=${o.Status}  remaining=${money(o.RemainingCredit ?? 0)}`);
  if (!(cns?.CreditNotes ?? []).length) console.log("    no credit notes");
}

console.log("\n=== C. Batch payments dated 2026-06-30 (rebuilds?) ===");
const bps = await xeroGet(`BatchPayments`);
for (const b of bps?.BatchPayments ?? []) {
  const d = pd(b.Date).slice(0, 10);
  if (d >= "2026-06-25" && d <= "2026-07-05") {
    console.log(`  ${d}  ${money(b.TotalAmount ?? 0)}  status=${b.Status}  rec=${b.IsReconciled}  id=${b.BatchPaymentID}  updated=${b.UpdatedDateUTC ? pd(b.UpdatedDateUTC) : "?"}`);
  }
}

console.log("\n=== D. All payments DELETED with UpdatedDateUTC on 25-27 Aug (blast radius) ===");
let count = 0;
for (let page = 1; page <= 10; page++) {
  const data = await xeroGet(`Payments?where=${encodeURIComponent('Status=="DELETED"')}&order=UpdatedDateUTC DESC&page=${page}`);
  const arr = data?.Payments ?? [];
  for (const p of arr) {
    const u = pd(p.UpdatedDateUTC);
    if (u >= "2026-08-25" && u < "2026-08-28") {
      count++;
      console.log(`  del ${u}  pay-date=${pd(p.Date).slice(0, 10)}  ${money(p.Amount).padStart(12)}  ${(p.Invoice?.InvoiceNumber ?? "?").padEnd(14)} ${(p.Invoice?.Contact?.Name ?? "?").slice(0, 35)}  batch=${p.BatchPayment?.BatchPaymentID?.slice(0, 8) ?? "-"}`);
    }
  }
  if (arr.length < 100) break;
  if (arr.length && pd(arr[arr.length - 1].UpdatedDateUTC) < "2026-08-25") break;
}
console.log(`  total deleted 25-27 Aug: ${count}`);
