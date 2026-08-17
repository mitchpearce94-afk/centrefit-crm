// READ-ONLY audit: 602 Group account — statement balance vs Xero balance gap,
// and enumeration of "User"-source statement lines.
//
// Pulls:
//   1. Reports/BankStatement (has Source column: Feed / Import / User) across
//      FY25+FY26 — counts + lists User lines, sums by source & reconciled flag.
//   2. Reports/BankSummary — Xero-side (GL) closing balance for the account.
//   3. Unreconciled AUTHORISED Payments recorded against 602.
//   4. Unreconciled AUTHORISED BankTransactions (spend/receive money) on 602.
// Then prints a reconciliation bridge from statement balance to Xero balance.
//
// Auth pattern copied from xero-unreconciled-payments-audit.mjs.
// Output: console + scripts/xero-bank-rec-gap.json  — NOTHING is written to Xero.
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

try {
  const payload = JSON.parse(Buffer.from(conn.access_token.split(".")[1], "base64url").toString());
  console.log("Token scopes:", Array.isArray(payload.scope) ? payload.scope.join(" ") : payload.scope);
} catch { /* non-fatal */ }

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
  const text = await res.text();
  let data = null;
  try { data = JSON.parse(text); } catch { /* empty or non-JSON body */ }
  if (!res.ok) { console.error(`[WARN] ${path.split("?")[0]} failed:`, res.status, (text || "").slice(0, 200)); return null; }
  return data;
};

const parseXeroDate = (d) => {
  if (!d) return null;
  const m = /\/Date\((\d+)/.exec(d);
  return m ? new Date(Number(m[1])).toISOString().slice(0, 10) : String(d).slice(0, 10);
};
const money = (n) => (n ?? 0).toLocaleString("en-AU", { style: "currency", currency: "AUD" });
const sum = (arr, f = (r) => r.amount ?? 0) => arr.reduce((s, r) => s + f(r), 0);

// ---- 1. Find the 602 Group bank account ----
const accountsData = await xeroGet("Accounts?where=" + encodeURIComponent('Type=="BANK"'));
if (!accountsData) { console.error("Cannot even list accounts — token/scope problem, aborting."); process.exit(1); }
const banks = accountsData.Accounts ?? [];
const acct602 = banks.find((a) => a.Code === "602");
if (!acct602) {
  console.error("No bank account with code 602. Banks found:", banks.map((a) => `${a.Code} ${a.Name}`).join(", "));
  process.exit(1);
}
console.log(`Target account: ${acct602.Code} ${acct602.Name} (${acct602.AccountID})`);
console.log("");

// ---- 2. Bank Statement report (Source column lives here) ----
// Fetch in FY chunks in case the report caps long ranges.
const TODAY = new Date().toISOString().slice(0, 10);
const ranges = [
  ["2024-07-01", "2025-06-30"],
  ["2025-07-01", TODAY],
];

// Report JSON: Reports[0].Rows = [ {RowType:Header,Cells:[{Value}]}, {RowType:Section,Rows:[{RowType:Row,Cells:[...]}]} ]
const stmtLines = [];
let headerTitles = null;
for (const [from, to] of ranges) {
  const rep = await xeroGet(`Reports/BankStatement?bankAccountID=${acct602.AccountID}&fromDate=${from}&toDate=${to}`);
  const report = rep?.Reports?.[0];
  if (!report) { console.error(`No BankStatement report for ${from}..${to} (missing accounting.reports.bankstatement.read scope?)`); continue; }
  const walk = (rows) => {
    for (const row of rows ?? []) {
      if (row.RowType === "Header") headerTitles = row.Cells.map((c) => c.Value);
      if (row.RowType === "Row" || row.RowType === "SummaryRow") {
        const cells = row.Cells?.map((c) => c.Value) ?? [];
        stmtLines.push({ range: `${from}..${to}`, rowType: row.RowType, cells });
      }
      if (row.Rows) walk(row.Rows);
    }
  };
  walk(report.Rows);
}
const haveStatement = !!headerTitles;
if (haveStatement) console.log("BankStatement report columns:", headerTitles.join(" | "));
else console.log("BankStatement report unavailable — skipping statement-line analysis.");

const col = (name) => (headerTitles ?? []).findIndex((t) => (t ?? "").toLowerCase() === name.toLowerCase());
const iDate = col("Date"), iDesc = col("Description"), iRef = col("Reference"),
  iRec = col("Reconciled"), iSrc = col("Source"), iAmt = col("Amount"), iBal = col("Balance");

const lines = !haveStatement ? [] : stmtLines
  .filter((r) => r.rowType === "Row")
  .map((r) => ({
    date: r.cells[iDate] ?? "",
    desc: (r.cells[iDesc] ?? "").toString(),
    ref: iRef >= 0 ? (r.cells[iRef] ?? "").toString() : "",
    reconciled: (r.cells[iRec] ?? "").toString(),
    source: iSrc >= 0 ? (r.cells[iSrc] ?? "").toString() : "?",
    amount: Number(r.cells[iAmt] ?? 0),
    balance: iBal >= 0 ? Number(r.cells[iBal] ?? 0) : null,
  }))
  // opening/closing balance pseudo-rows have no amount cell — drop rows with empty desc AND 0 amount
  .filter((l) => !(l.amount === 0 && l.desc.toLowerCase().includes("balance")));

console.log(`Statement lines fetched (both ranges): ${lines.length}`);
const closing = lines.length ? lines[lines.length - 1].balance : null;
console.log(`Last line running balance (statement balance as of ${TODAY}): ${closing != null ? money(closing) : "n/a (no Balance col)"}`);
console.log("");

console.log("=== Statement lines by Source ===");
const bySrc = {};
for (const l of lines) (bySrc[l.source || "?"] ??= []).push(l);
for (const [s, list] of Object.entries(bySrc)) {
  console.log(`${s.padEnd(10)} ${String(list.length).padStart(5)} lines   net ${money(sum(list, (l) => l.amount))}`);
}
console.log("");

console.log("=== Statement lines by Source x Reconciled ===");
const byKey = {};
for (const l of lines) (byKey[`${l.source || "?"} / rec=${l.reconciled}`] ??= []).push(l);
for (const [k, list] of Object.entries(byKey).sort()) {
  console.log(`${k.padEnd(22)} ${String(list.length).padStart(5)} lines   net ${money(sum(list, (l) => l.amount))}`);
}
console.log("");

const userLines = lines.filter((l) => (l.source || "").toLowerCase().includes("user"));
console.log(`=== ALL User-source statement lines (${userLines.length}) ===`);
for (const l of userLines) {
  console.log(`${l.date}  ${money(l.amount).padStart(14)}  rec=${String(l.reconciled).padEnd(5)} ${l.desc.slice(0, 60)}${l.ref ? `  ref=${l.ref.slice(0, 25)}` : ""}`);
}
console.log("");

const unrecStmt = lines.filter((l) => String(l.reconciled).toLowerCase() !== "yes" && String(l.reconciled).toLowerCase() !== "true");
console.log(`=== Unreconciled statement lines (${unrecStmt.length}) net ${money(sum(unrecStmt, (l) => l.amount))} ===`);
for (const l of unrecStmt) {
  console.log(`${l.date}  ${money(l.amount).padStart(14)}  src=${l.source.padEnd(6)} ${l.desc.slice(0, 60)}`);
}
console.log("");

// ---- 3. Xero-side (GL) balance via BankSummary ----
const bs = await xeroGet(`Reports/BankSummary?fromDate=2024-07-01&toDate=${TODAY}`);
let xeroBal = null;
if (bs) {
  const report = bs.Reports?.[0];
  const hdr = report?.Rows?.find((r) => r.RowType === "Header")?.Cells.map((c) => c.Value) ?? [];
  const iName = 0;
  const iClose = hdr.findIndex((t) => (t ?? "").toLowerCase().includes("closing"));
  const walk = (rows) => {
    for (const row of rows ?? []) {
      if (row.RowType === "Row") {
        const name = row.Cells?.[iName]?.Value ?? "";
        if (name === acct602.Name) xeroBal = Number(row.Cells?.[iClose]?.Value ?? 0);
      }
      if (row.Rows) walk(row.Rows);
    }
  };
  walk(report?.Rows);
}
console.log(`Xero (GL) closing balance for ${acct602.Name}: ${xeroBal != null ? money(xeroBal) : "NOT FOUND in BankSummary"}`);
console.log("");

// ---- 4. Unreconciled Xero-side transactions on 602 ----
// 4a. Payments (bill payments / customer receipts recorded straight to the bank account)
const pays = [];
for (let page = 1; ; page++) {
  const where = encodeURIComponent('Status=="AUTHORISED" AND Date>=DateTime(2024,07,01)');
  const data = await xeroGet(`Payments?where=${where}&order=Date&page=${page}`);
  if (!data) break;
  const batch = data.Payments ?? [];
  pays.push(...batch);
  if (batch.length < 100) break;
}
const unrecPays = pays.filter((p) => p.IsReconciled === false &&
  (p.Account?.AccountID === acct602.AccountID || p.Account?.Code === "602"));
// signed impact on the GL balance: ACCRECPAYMENT = money in (+), ACCPAYPAYMENT = money out (−)
const paySigned = (p) => (p.PaymentType === "ACCRECPAYMENT" ? 1 : -1) * (p.Amount ?? 0);
console.log(`=== Unreconciled AUTHORISED payments on 602 (${unrecPays.length}) net GL impact ${money(sum(unrecPays, paySigned))} ===`);
for (const p of unrecPays.sort((a, b) => (a.Date ?? "").localeCompare(b.Date ?? ""))) {
  console.log(`${parseXeroDate(p.Date)}  ${(p.PaymentType === "ACCRECPAYMENT" ? "IN " : "OUT")}  ${money(p.Amount).padStart(13)}  ` +
    `${(p.Invoice?.InvoiceNumber ?? "?").padEnd(12)} ${(p.Invoice?.Contact?.Name ?? "?").slice(0, 40)}${p.BatchPayment?.BatchPaymentID ? "  [batch]" : ""}`);
}
console.log("");

// 4b. Spend/receive money (BankTransactions) on 602
const btx = [];
for (let page = 1; ; page++) {
  const where = encodeURIComponent(`BankAccount.Code=="602" AND Status=="AUTHORISED" AND IsReconciled==false`);
  const data = await xeroGet(`BankTransactions?where=${where}&order=Date&page=${page}`);
  if (!data) break;
  const batch = data.BankTransactions ?? [];
  btx.push(...batch);
  if (batch.length < 100) break;
}
const btxSigned = (t) => (String(t.Type).startsWith("RECEIVE") ? 1 : -1) * (t.Total ?? 0);
console.log(`=== Unreconciled AUTHORISED spend/receive money on 602 (${btx.length}) net GL impact ${money(sum(btx, btxSigned))} ===`);
for (const t of btx) {
  console.log(`${parseXeroDate(t.Date)}  ${String(t.Type).padEnd(14)} ${money(t.Total).padStart(13)}  ${(t.Contact?.Name ?? "?").slice(0, 40)}  ref=${(t.Reference ?? "").slice(0, 25)}`);
}
console.log("");

// ---- 5. The bridge ----
const unrecStmtNet = sum(unrecStmt, (l) => l.amount);
const unrecXeroNet = sum(unrecPays, paySigned) + sum(btx, btxSigned);
console.log("=== RECONCILIATION BRIDGE ===");
console.log(`Statement balance (feed side):            ${closing != null ? money(closing) : "?"}`);
console.log(`Xero GL balance:                          ${xeroBal != null ? money(xeroBal) : "?"}`);
if (closing != null && xeroBal != null) {
  const gap = closing - xeroBal;
  console.log(`GAP (statement - Xero):                   ${money(gap)}`);
  console.log("");
  console.log(`Unreconciled statement lines (net):       ${money(unrecStmtNet)}  (in statement bal, not yet in Xero)`);
  console.log(`Unreconciled Xero txns (net GL impact):   ${money(unrecXeroNet)}  (in Xero bal, not matched to feed)`);
  const explained = unrecStmtNet - unrecXeroNet;
  console.log(`Explained by the above:                   ${money(explained)}`);
  console.log(`RESIDUAL (mark-as-reconciled / history):  ${money(gap - explained)}`);
  console.log("   ^ residual = reconciled Xero txns with NO real statement line (Mark as Reconciled),");
  console.log("     or User statement lines with no real bank movement, or pre-2024-07 drift.");
}

writeFileSync(new URL("./xero-bank-rec-gap.json", import.meta.url), JSON.stringify({
  account: { code: acct602.Code, name: acct602.Name, id: acct602.AccountID },
  statementClosing: closing,
  xeroBalance: xeroBal,
  bySource: Object.fromEntries(Object.entries(bySrc).map(([s, list]) => [s, { count: list.length, net: sum(list, (l) => l.amount) }])),
  userLines,
  unreconciledStatementLines: unrecStmt,
  unreconciledPayments: unrecPays.map((p) => ({
    date: parseXeroDate(p.Date), amount: p.Amount, type: p.PaymentType,
    invoice: p.Invoice?.InvoiceNumber, contact: p.Invoice?.Contact?.Name,
    batch: p.BatchPayment?.BatchPaymentID ?? null, paymentId: p.PaymentID,
  })),
  unreconciledBankTransactions: btx.map((t) => ({
    date: parseXeroDate(t.Date), amount: t.Total, type: t.Type,
    contact: t.Contact?.Name, reference: t.Reference, id: t.BankTransactionID,
  })),
}, null, 2));
console.log("");
console.log("Raw dump: scripts/xero-bank-rec-gap.json");
