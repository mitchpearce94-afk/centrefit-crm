// READ-ONLY: investigate the 30 Jun EOFY $59,053.52 batch (a9a4d64b, ANZ ref 600855).
// Who unreconciled/deleted it, current status of every payment + member bill.
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const BATCH_ID = "a9a4d64b-edc2-4f96-88c7-56eeb73e5413";
// From xero-forensics-raw.json snapshot (17 Aug): the 10 payments in the batch.
const SNAPSHOT = [
  { pay: "9d057a61-00b1-4cdd-9050-3f2202c42979", amt: 9900.0, inv: "2d49e8d9-cafc-45d1-8030-3f3910000f52", num: "711", who: "Premier Power Solutions" },
  { pay: "b17383b9-21dc-4ab5-9f8c-4dbda6527101", amt: 1037.86, inv: "9538edde-c18b-430f-b191-04ec43aa47c3", num: "1801457", who: "Seadan" },
  { pay: "d59102d0-7307-46ad-bcf3-50dc77eb00f4", amt: 24.75, inv: "8a5d86ee-4fd5-4c77-96a2-b6ab95aec5d2", num: "?", who: "DSTECH" },
  { pay: "6b570302-739d-4937-8070-69330e28aab7", amt: 11082.25, inv: "f8190385-b458-47dc-b22b-b3e68770767e", num: "449700", who: "Electrocraft" },
  { pay: "95eff612-73eb-4d14-ac5b-6e98165aabd0", amt: 234.01, inv: "44300d01-f194-4cb8-8715-4e5eaba59d8c", num: "IN24595", who: "Upti" },
  { pay: "bdc5fd4e-a4a6-4641-a992-835d29cd5c38", amt: 16.5, inv: "228d44a3-8c97-4b12-b25b-73689456b527", num: "?", who: "DSTECH" },
  { pay: "0cc69fab-7790-4bc8-b2f1-a6c711e393d0", amt: 16.5, inv: "fd050393-20d1-4619-beca-2b1fbb21dd8b", num: "INT238173", who: "DSTECH" },
  { pay: "dd7010e9-04fa-45de-bb86-a91bfa42eba1", amt: 12656.1, inv: "eae2e0b0-61d7-49d3-86fc-23fcdf5df5c1", num: "449503", who: "Electrocraft" },
  { pay: "471a0690-4f8f-4a94-b241-e34a7c8700b7", amt: 9954.88, inv: "8e397ef0-99f3-4d8e-804f-2a942ee0c9bb", num: "449608", who: "Electrocraft" },
  { pay: "7dd3445e-f9e4-4467-8f88-fb1a3431552d", amt: 14130.67, inv: "9348c7f3-7f1a-4cb1-b240-0514cdbb6763", num: "449503", who: "Electrocraft" },
];

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

console.log("=== 1. Batch payment ===");
const bp = (await xeroGet(`BatchPayments/${BATCH_ID}`))?.BatchPayments?.[0];
if (bp) {
  console.log(`status=${bp.Status}  total=${money(bp.TotalAmount ?? 0)}  date=${pd(bp.Date)}  ref=${bp.Reference ?? ""}  IsReconciled=${bp.IsReconciled}`);
  console.log(`payments listed on batch: ${(bp.Payments ?? []).length}`);
} else console.log("batch GET returned nothing");

console.log("\n=== 2. Batch history (who/when, newest first) ===");
const bh = await xeroGet(`BatchPayments/${BATCH_ID}/History`);
for (const h of (bh?.HistoryRecords ?? []).slice(0, 20)) {
  console.log(`  ${pd(h.DateUTC)}  [${h.Changes ?? "?"}] ${(h.User ?? "").padEnd(22)} ${(h.Details ?? "").slice(0, 120)}`);
}

console.log("\n=== 3. Each payment + bill, live status ===");
for (const s of SNAPSHOT) {
  const p = (await xeroGet(`Payments/${s.pay}`))?.Payments?.[0];
  const inv = (await xeroGet(`Invoices/${s.inv}`))?.Invoices?.[0];
  console.log(`\n${s.who}  ${inv?.InvoiceNumber ?? s.num}  ${money(s.amt)}`);
  console.log(`  payment: status=${p?.Status ?? "?"}  IsReconciled=${p?.IsReconciled ?? "?"}  updated=${p?.UpdatedDateUTC ? pd(p.UpdatedDateUTC) : "?"}`);
  console.log(`  bill:    status=${inv?.Status ?? "?"}  due=${inv ? money(inv.AmountDue) : "?"}  dueDate=${inv?.DueDate ? pd(inv.DueDate).slice(0, 10) : "?"}  paid=${inv ? money(inv.AmountPaid) : "?"}`);
  const hist = await xeroGet(`Invoices/${s.inv}/History`);
  const recent = (hist?.HistoryRecords ?? []).filter((h) => {
    const m = /\/Date\((\d+)/.exec(h.DateUTC);
    return m && Number(m[1]) > Date.parse("2026-08-20");
  }).slice(0, 6);
  for (const h of recent) {
    console.log(`    hist ${pd(h.DateUTC)}  [${h.Changes ?? "?"}] ${(h.User ?? "").padEnd(20)} ${(h.Details ?? "").slice(0, 110)}`);
  }
}
