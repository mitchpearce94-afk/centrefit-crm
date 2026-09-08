// READ-ONLY: all ACCPAY bills awaiting payment, with amounts and dates,
// plus each bill's payment history (incl. deleted payments where visible).
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
  if (!res.ok) { console.error(`[WARN] ${path.split("?")[0]}:`, res.status, text.slice(0, 120)); return null; }
  return data;
};
const pd = (d) => { const m = /\/Date\((\d+)/.exec(d); return m ? new Date(Number(m[1])).toISOString().slice(0, 10) : String(d).slice(0, 10); };
const money = (n) => (n ?? 0).toLocaleString("en-AU", { style: "currency", currency: "AUD" });

// ── READ-ONLY audit: deleted Telstra batch payment fallout ──────────────
// 1) every ACCPAY bill awaiting payment; 2) every batch payment (incl.
// deleted) and its member bills; 3) recently deleted bill payments.
// Cross-references which awaiting bills fell out of a deleted batch.

const awaiting = [];
for (let page = 1; ; page++) {
  const where = encodeURIComponent('Type=="ACCPAY" AND Status=="AUTHORISED"');
  const data = await xeroGet(`Invoices?where=${where}&order=Date&page=${page}`);
  if (!data) break;
  const batch = data.Invoices ?? [];
  awaiting.push(...batch);
  if (batch.length < 100) break;
}
const awaitingById = new Map(awaiting.map((b) => [b.InvoiceID, b]));
console.log(`AWAITING PAYMENT: ${awaiting.length} bills, ${money(awaiting.reduce((s, b) => s + (b.AmountDue ?? 0), 0))} total\n`);

const bp = await xeroGet("BatchPayments");
const batches = bp?.BatchPayments ?? [];
console.log(`BATCH PAYMENTS visible: ${batches.length}\n`);

for (const b of batches) {
  const pays = b.Payments ?? [];
  const memberIds = pays.map((p) => p.Invoice?.InvoiceID).filter(Boolean);
  const members = memberIds.map((id) => awaitingById.get(id)).filter(Boolean);
  const hasTelstra = pays.some((p) => (p.Invoice?.Contact?.Name ?? "").toLowerCase().includes("telstra"));
  const interesting = b.Status === "DELETED" || hasTelstra || members.length > 0;
  if (!interesting) continue;
  console.log(`── Batch ${pd(b.Date)}  ${money(Number(b.TotalAmount ?? b.Amount ?? 0))}  status=${b.Status}  ref="${b.Reference ?? ""}"  id=${b.BatchPaymentID}`);
  for (const p of pays) {
    const inv = p.Invoice ?? {};
    const nowAwaiting = awaitingById.has(inv.InvoiceID);
    console.log(`     ${money(Number(p.Amount ?? 0)).padStart(12)}  ${(inv.Contact?.Name ?? "?").slice(0, 34).padEnd(36)} ${inv.InvoiceNumber ?? inv.InvoiceID}${nowAwaiting ? "   << NOW AWAITING PAYMENT" : ""}`);
  }
  console.log("");
}

// Deleted ACCPAY payments in the last 90 days — catches single payment removals
const since = new Date(Date.now() - 90 * 86400e3).toISOString().slice(0, 10);
const delWhere = encodeURIComponent(`Status=="DELETED" AND PaymentType=="ACCPAYPAYMENT"`);
const delData = await xeroGet(`Payments?where=${delWhere}&order=UpdatedDateUTC DESC`);
const dels = (delData?.Payments ?? []).filter((p) => {
  const m = /\/Date\((\d+)/.exec(p.UpdatedDateUTC ?? "");
  return m ? Number(m[1]) > Date.now() - 90 * 86400e3 : true;
});
console.log(`\nDELETED bill payments (updated last 90d): ${dels.length}`);
for (const p of dels) {
  const inv = p.Invoice ?? {};
  const nowAwaiting = awaitingById.has(inv.InvoiceID);
  console.log(`  ${pd(p.Date)}  ${money(Number(p.Amount ?? 0)).padStart(12)}  ${(inv.Contact?.Name ?? "?").slice(0, 30).padEnd(32)} ${inv.InvoiceNumber ?? ""}  batch=${p.BatchPaymentID ?? p.BatchPayment?.BatchPaymentID ?? "-"}${nowAwaiting ? "   << NOW AWAITING" : ""}`);
}

// ── detail pass: awaiting bills annotated with recent payment deletions ──
const delByInvoice = new Map();
for (const p of dels) {
  const id = p.Invoice?.InvoiceID;
  if (!id) continue;
  const upd = /\/Date\((\d+)/.exec(p.UpdatedDateUTC ?? "");
  const when = upd ? new Date(Number(upd[1])).toISOString().slice(0, 10) : "?";
  (delByInvoice.get(id) ?? delByInvoice.set(id, []).get(id)).push({ amt: p.Amount, deletedOn: when, payDate: pd(p.Date) });
}
console.log("\n\nAWAITING BILLS — full list (with any recently deleted payments):");
for (const b of awaiting.sort((a, c) => (a.Contact?.Name ?? "").localeCompare(c.Contact?.Name ?? ""))) {
  const d = delByInvoice.get(b.InvoiceID);
  console.log(`  ${pd(b.Date)}  ${money(b.AmountDue).padStart(12)}  ${(b.Contact?.Name ?? "?").slice(0, 34).padEnd(36)} ${b.InvoiceNumber ?? ""}${d ? `   [payment(s) DELETED: ${d.map((x) => `${money(Number(x.amt))} on ${x.deletedOn}`).join(", ")}]` : ""}`);
}

// ── pass 3: resolve members of AUTHORISED batches + recently-updated batches ──
console.log("\n\nBATCHES UPDATED SINCE 20 AUG (any status):");
for (const b of batches) {
  const m = /\/Date\((\d+)/.exec(b.UpdatedDateUTC ?? "");
  const upd = m ? new Date(Number(m[1])) : null;
  if (!upd || upd < new Date("2026-08-20")) continue;
  console.log(`  batch dated ${pd(b.Date)}  ${money(Number(b.TotalAmount ?? b.Amount ?? 0))}  status=${b.Status}  UPDATED ${upd.toISOString().slice(0, 16)}  id=${b.BatchPaymentID}`);
}

for (const bid of ["e8574cc9-ecd4-4a9c-bea4-18cc44cf0c95", "a9a4d64b-edc2-4f96-88c7-56eeb73e5413"]) {
  const b = batches.find((x) => x.BatchPaymentID === bid);
  if (!b) continue;
  console.log(`\nMEMBERS of batch ${pd(b.Date)} ${money(Number(b.TotalAmount ?? b.Amount ?? 0))} (${b.Status}):`);
  for (const p of b.Payments ?? []) {
    const inv = p.Invoice ?? {};
    const full = inv.InvoiceID ? await xeroGet(`Invoices/${inv.InvoiceID}`) : null;
    const i = full?.Invoices?.[0];
    console.log(`  ${money(Number(p.Amount ?? 0)).padStart(12)}  ${(i?.Contact?.Name ?? "?").slice(0, 34).padEnd(36)} ${i?.InvoiceNumber ?? ""}  status=${i?.Status}  due=${money(i?.AmountDue ?? 0)}`);
  }
}

// ── pass 4: members of the batches touched since 20 Aug ──
for (const bid of ["0cc3cdea-c133-4edc-aaba-e54331ab6dba", "241af1c0-1800-4788-817c-3a97f251de94", "9514c7c4-8ed0-43a5-9321-49fbbbf90532"]) {
  const b = batches.find((x) => x.BatchPaymentID === bid);
  if (!b) continue;
  console.log(`\nMEMBERS of batch dated ${pd(b.Date)} ${money(Number(b.TotalAmount ?? b.Amount ?? 0))} (${b.Status}):`);
  for (const p of b.Payments ?? []) {
    const inv = p.Invoice ?? {};
    const full = inv.InvoiceID ? await xeroGet(`Invoices/${inv.InvoiceID}`) : null;
    const i = full?.Invoices?.[0];
    console.log(`  ${money(Number(p.Amount ?? 0)).padStart(12)}  ${(i?.Contact?.Name ?? "?").slice(0, 34).padEnd(36)} ${i?.InvoiceNumber ?? ""}  status=${i?.Status}`);
  }
}
