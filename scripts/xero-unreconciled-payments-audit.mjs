// READ-ONLY audit: find Xero payments that were applied to invoices/bills
// (marking them paid) but have never been matched to a bank statement line
// (IsReconciled == false). These are what make reconciliation reports drift
// from the actual bank balance.
//
// Auth pattern copied from xero-list-repeating.mjs — token from
// xero_connections, refreshed + persisted if expired.
// Output: console summary + scripts/xero-unreconciled-payments.json
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

const { data: conn, error } = await supabase
  .from("xero_connections")
  .select("id, tenant_id, access_token, refresh_token, expires_at")
  .order("updated_at", { ascending: false })
  .limit(1)
  .single();
if (error || !conn) { console.error("No Xero connection:", error?.message); process.exit(1); }

let accessToken = conn.access_token;
const expired = !conn.expires_at || new Date(conn.expires_at).getTime() < Date.now() + 60_000;
if (expired) {
  const res = await fetch("https://identity.xero.com/connect/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: "Basic " + Buffer.from(`${env.XERO_CLIENT_ID}:${env.XERO_CLIENT_SECRET}`).toString("base64"),
    },
    body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: conn.refresh_token }),
  });
  const tok = await res.json();
  if (!res.ok) { console.error("Token refresh failed:", JSON.stringify(tok)); process.exit(1); }
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

// Xero JSON returns .NET-style dates: /Date(1518685950940+0000)/
const parseXeroDate = (d) => {
  if (!d) return null;
  const m = /\/Date\((\d+)/.exec(d);
  return m ? new Date(Number(m[1])).toISOString().slice(0, 10) : String(d).slice(0, 10);
};

// Account map so we can name the account each payment was recorded against
// and flag payments recorded to non-bank accounts (those can never reconcile).
const accountsData = await xeroGet("Accounts");
const accountById = {}, accountByCode = {};
for (const a of accountsData.Accounts ?? []) {
  accountById[a.AccountID] = a;
  if (a.Code) accountByCode[a.Code] = a;
}

// Page through AUTHORISED payments since FY26 start. DELETED ones are excluded
// by the status filter; IsReconciled is filtered client-side.
const all = [];
for (let page = 1; ; page++) {
  const where = encodeURIComponent('Status=="AUTHORISED" AND Date>=DateTime(2025,07,01)');
  const data = await xeroGet(`Payments?where=${where}&order=Date&page=${page}`);
  const batch = data.Payments ?? [];
  all.push(...batch);
  if (batch.length < 100) break;
}

const unrec = all.filter((p) => p.IsReconciled === false);

const enrich = (p) => {
  const acctRef = p.Account ?? {};
  const acct = accountById[acctRef.AccountID] ?? accountByCode[acctRef.Code] ?? acctRef;
  const inv = p.Invoice ?? {};
  return {
    paymentId: p.PaymentID,
    date: parseXeroDate(p.Date),
    amount: p.Amount,
    reference: p.Reference ?? "",
    paymentType: p.PaymentType, // ACCRECPAYMENT = money in, ACCPAYPAYMENT = money out
    status: p.Status,
    batchPaymentId: p.BatchPayment?.BatchPaymentID ?? p.BatchPaymentID ?? null,
    account: { code: acct.Code ?? acctRef.Code ?? "?", name: acct.Name ?? "?", type: acct.Type ?? "?" },
    invoice: {
      number: inv.InvoiceNumber ?? "?",
      type: inv.Type ?? "?",
      contact: inv.Contact?.Name ?? "?",
    },
    updatedUTC: parseXeroDate(p.UpdatedDateUTC),
  };
};

const rows = unrec.map(enrich).sort((a, b) => (a.date ?? "").localeCompare(b.date ?? ""));
writeFileSync(new URL("./xero-unreconciled-payments.json", import.meta.url), JSON.stringify(rows, null, 2));

const money = (n) => n.toLocaleString("en-AU", { style: "currency", currency: "AUD" });
const sum = (arr) => arr.reduce((s, r) => s + (r.amount ?? 0), 0);

console.log(`Payments fetched (AUTHORISED, since 2025-07-01): ${all.length}`);
console.log(`UNRECONCILED: ${rows.length} totalling ${money(sum(rows))}`);
console.log("");

const byType = {};
for (const r of rows) (byType[r.paymentType] ??= []).push(r);
console.log("=== By direction ===");
for (const [t, list] of Object.entries(byType)) {
  const dir = t === "ACCRECPAYMENT" ? "money IN (customer receipts)" : t === "ACCPAYPAYMENT" ? "money OUT (bill payments)" : t;
  console.log(`${t.padEnd(18)} ${dir.padEnd(32)} ${String(list.length).padStart(4)} payments  ${money(sum(list))}`);
}

console.log("");
console.log("=== By account the payment was recorded to ===");
const byAcct = {};
for (const r of rows) (byAcct[`${r.account.code} ${r.account.name} [${r.account.type}]`] ??= []).push(r);
for (const [k, list] of Object.entries(byAcct).sort((a, b) => sum(b[1]) - sum(a[1]))) {
  console.log(`${k.padEnd(55)} ${String(list.length).padStart(4)} payments  ${money(sum(list))}`);
}

console.log("");
console.log("=== By contact (top 25 by $) ===");
const byContact = {};
for (const r of rows) (byContact[r.invoice.contact] ??= []).push(r);
for (const [k, list] of Object.entries(byContact).sort((a, b) => sum(b[1]) - sum(a[1])).slice(0, 25)) {
  console.log(`${k.slice(0, 50).padEnd(52)} ${String(list.length).padStart(4)} payments  ${money(sum(list))}`);
}

console.log("");
console.log("=== Full listing ===");
for (const r of rows) {
  console.log(
    `${r.date}  ${r.paymentType === "ACCRECPAYMENT" ? "IN " : "OUT"}  ${money(r.amount ?? 0).padStart(12)}  ` +
    `${r.invoice.number.padEnd(12)} ${r.invoice.contact.slice(0, 35).padEnd(37)} acct=${r.account.code} ${r.account.name.slice(0, 25)}` +
    `${r.batchPaymentId ? "  [batch]" : ""}${r.reference ? `  ref=${r.reference.slice(0, 30)}` : ""}`
  );
}
