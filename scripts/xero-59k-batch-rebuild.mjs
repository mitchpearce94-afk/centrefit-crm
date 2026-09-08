// WRITE SCRIPT (Mitchell-approved 2026-08-31): rebuild the deleted 30-Jun EOFY
// $59,053.52 batch (ANZ ref 600855) that Amanda Di Tommaso deleted 26 Aug.
// Ops: void dup 449503 twin, 6 payments, 2 spend-overpayments, credit note
// $1,474.57 + allocation to kept 449503. Aborts on first failure.
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const ANZ_602 = "69ea74f1-ef5d-4879-8cfc-d97762af6308";
const KEEP_449503 = "eae2e0b0-61d7-49d3-86fc-23fcdf5df5c1"; // 22-May manual
const VOID_449503 = "9348c7f3-7f1a-4cb1-b240-0514cdbb6763"; // 29-Jun email-to-bill twin
const REF = "ANZ multi-pay 600855 rebuild";
const PAY_DATE = "2026-06-30";
const TODAY = "2026-08-31";

const PAYMENTS = [
  { inv: "2d49e8d9-cafc-45d1-8030-3f3910000f52", amt: 9900.0, label: "Premier Power 711" },
  { inv: "9538edde-c18b-430f-b191-04ec43aa47c3", amt: 1037.86, label: "Seadan 1801457" },
  { inv: "f8190385-b458-47dc-b22b-b3e68770767e", amt: 11082.25, label: "Electrocraft 449700" },
  { inv: "8e397ef0-99f3-4d8e-804f-2a942ee0c9bb", amt: 9954.88, label: "Electrocraft 449608" },
  { inv: "44300d01-f194-4cb8-8715-4e5eaba59d8c", amt: 234.01, label: "Upti IN24595" },
  { inv: KEEP_449503, amt: 12656.1, label: "Electrocraft 449503 (kept)" },
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

const xero = async (method, path, body) => {
  const res = await fetch(`https://api.xero.com/api.xro/2.0/${path}${path.includes("?") ? "&" : "?"}summarizeErrors=false`, {
    method,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Xero-tenant-id": conn.tenant_id,
      Accept: "application/json",
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data = null; try { data = JSON.parse(text); } catch {}
  return { ok: res.ok, status: res.status, data, text };
};
const die = (step, r) => {
  console.error(`\n!!! FAILED at ${step}: HTTP ${r.status}`);
  console.error(r.text.slice(0, 2000));
  process.exit(1);
};
const money = (n) => Number(n).toLocaleString("en-AU", { style: "currency", currency: "AUD" });

// --- Step 0: get contact IDs + expense account from live bills ---
const keep = await xero("GET", `Invoices/${KEEP_449503}`);
if (!keep.ok) die("read kept 449503", keep);
const ecContact = keep.data.Invoices[0].Contact.ContactID;
const ecAccountCode = keep.data.Invoices[0].LineItems?.[0]?.AccountCode;
const ds = await xero("GET", `Invoices/fd050393-20d1-4619-beca-2b1fbb21dd8b`);
if (!ds.ok) die("read DSTECH INT238173", ds);
const dsContact = ds.data.Invoices[0].Contact.ContactID;
console.log(`Electrocraft contact=${ecContact}  expense account=${ecAccountCode}`);
console.log(`DSTECH contact=${dsContact}`);

// Guard: bills must still be unpaid/authorised before we act (no double-run).
for (const p of PAYMENTS) {
  const r = await xero("GET", `Invoices/${p.inv}`);
  if (!r.ok) die(`pre-check ${p.label}`, r);
  const inv = r.data.Invoices[0];
  if (inv.Status !== "AUTHORISED" || inv.AmountPaid !== 0) {
    console.error(`ABORT: ${p.label} is ${inv.Status} paid=${inv.AmountPaid} — state changed since preflight, re-verify.`);
    process.exit(1);
  }
}
console.log("Pre-check OK: all 6 bills AUTHORISED with $0 paid.\n");

// --- Step 1: void the duplicate 449503 twin ---
console.log("Step 1: void duplicate 449503 twin...");
const v = await xero("POST", `Invoices/${VOID_449503}`, { InvoiceID: VOID_449503, Status: "VOIDED" });
if (!v.ok) die("void twin", v);
console.log(`  voided -> status=${v.data.Invoices?.[0]?.Status}`);

// --- Step 2: create the 6 payments ---
console.log("\nStep 2: create 6 payments dated 30 Jun from ANZ 602...");
const pay = await xero("PUT", "Payments", {
  Payments: PAYMENTS.map((p) => ({
    Invoice: { InvoiceID: p.inv },
    Account: { AccountID: ANZ_602 },
    Date: PAY_DATE,
    Amount: p.amt,
    Reference: REF,
  })),
});
if (!pay.ok) die("create payments", pay);
for (const [i, p] of (pay.data.Payments ?? []).entries()) {
  console.log(`  ${PAYMENTS[i].label.padEnd(28)} ${money(p.Amount).padStart(12)}  status=${p.Status}  id=${p.PaymentID}`);
}

// --- Step 3: overpayments ---
console.log("\nStep 3: create spend-overpayments...");
const op = await xero("PUT", "BankTransactions", {
  BankTransactions: [
    {
      Type: "SPEND-OVERPAYMENT",
      Contact: { ContactID: ecContact },
      BankAccount: { AccountID: ANZ_602 },
      Date: PAY_DATE,
      Reference: `${REF} — 449503 paid twice in EOFY batch`,
      LineAmountTypes: "NoTax",
      LineItems: [{ Description: "Electrocraft double-payment of inv 449503 in 30-Jun multi-pay 600855 (bank debited both). Credit held by Electrocraft.", LineAmount: 14130.67 }],
    },
    {
      Type: "SPEND-OVERPAYMENT",
      Contact: { ContactID: dsContact },
      BankAccount: { AccountID: ANZ_602 },
      Date: PAY_DATE,
      Reference: `${REF} — DSTECH voided dup bills`,
      LineAmountTypes: "NoTax",
      LineItems: [{ Description: "DSTECH paid $57.75 in 30-Jun multi-pay 600855; $41.25 of bills voided as duplicates 26 Aug. Credit held by DSTECH.", LineAmount: 41.25 }],
    },
  ],
});
if (!op.ok) die("create overpayments", op);
for (const t of op.data.BankTransactions ?? []) {
  console.log(`  ${t.Contact?.Name?.padEnd(28)} ${money(t.Total).padStart(12)}  type=${t.Type}  id=${t.BankTransactionID}`);
}

// --- Step 4: credit note 1,474.57 + allocate to kept 449503 ---
console.log("\nStep 4: credit note $1,474.57 + allocation...");
const cn = await xero("PUT", "CreditNotes", {
  CreditNotes: [{
    Type: "ACCPAYCREDIT",
    Contact: { ContactID: ecContact },
    Date: TODAY,
    Status: "AUTHORISED",
    CreditNoteNumber: "CN-449503-SWAP",
    LineAmountTypes: "Inclusive",
    LineItems: [{
      Description: "Electrocraft credit swap on inv 449503 (never entered; previously faked as a payment record — per Aug 2026 bank rec audit)",
      Quantity: 1,
      UnitAmount: 1474.57,
      AccountCode: ecAccountCode,
    }],
  }],
});
if (!cn.ok) die("create credit note", cn);
const cnId = cn.data.CreditNotes[0].CreditNoteID;
console.log(`  credit note ${cn.data.CreditNotes[0].CreditNoteNumber}  ${money(cn.data.CreditNotes[0].Total)}  status=${cn.data.CreditNotes[0].Status}  id=${cnId}`);

const alloc = await xero("PUT", `CreditNotes/${cnId}/Allocations`, {
  Allocations: [{ Invoice: { InvoiceID: KEEP_449503 }, Amount: 1474.57, Date: TODAY }],
});
if (!alloc.ok) die("allocate credit note", alloc);
console.log("  allocated $1,474.57 to kept 449503");

// --- Step 5: verify final state ---
console.log("\n=== VERIFY ===");
let liveTotal = 16.5; // Amanda's existing DSTECH payment
for (const p of PAYMENTS) {
  const r = await xero("GET", `Invoices/${p.inv}`);
  const inv = r.data?.Invoices?.[0];
  console.log(`  ${p.label.padEnd(28)} status=${inv?.Status}  due=${money(inv?.AmountDue ?? -1)}`);
  liveTotal += p.amt;
}
const twin = await xero("GET", `Invoices/${VOID_449503}`);
console.log(`  dup 449503 twin              status=${twin.data?.Invoices?.[0]?.Status}`);
liveTotal += 14130.67 + 41.25;
console.log(`\n  Live pieces for Find & Match total: ${money(liveTotal)}  (target $59,053.52)`);
