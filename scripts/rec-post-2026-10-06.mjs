// WRITES TO XERO when run with --post (dry run by default). Mitchell OK'd the 6 Oct 2026 rec sheet in chat ("the rest send it", on VA322).
// Pre-records the Xero side for the open 21 Sep–5 Oct statement lines on 602 (main) and 604 (CF Technicians) so each is a green one-click match.
//   A invoice payments in 602 (customer receipts, resolved by invoice no. in the bank reference)
//   B GoCardless payouts 29 Sep–5 Oct: ONE batch deposit + ONE fee spend (446) per payout   [28 Sep payout LEFT for Mitchell — Vermont South over-collection]
//   C draft bills: fix contact/code + approve; bill payments from 602 / 604 dated the statement line; Topton USD bill paid at the AUD actually sent
//   D spend money on 602 (wages 804, Nissan 843, Get Capital 840, Linkt 451, Youi 449, Uber 493, meals 306, Xero 485, AMO → new 844, overseas purchases BAS excluded)
//   E transfers 602→607 / 602→604
//   F spend money on 604 (tech card purchases)
//   G delete the PCBWay draft keyed in USD (replaced by the AUD spend in D)
// Skipped on purpose: Shift $40k (Veyla transfer pending), Airwave $2,056.99, DWP double payment, Vermont South, Stripe payouts (Find & Match in Xero).
// Every action re-checks live state first (invoice AmountDue / bill status) and skips if already done. Output: console + scripts/rec-post-2026-10-06.json.
import { readFileSync, writeFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
const POST = process.argv.includes("--post");
const env = Object.fromEntries(readFileSync(new URL("../.env.gc-probe", import.meta.url), "utf8").split("\n").filter((l) => l.includes("=") && !l.startsWith("#")).map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, "").replace(/\\r|\\n/g, "").replace(/\r|\n/g, "").trim()]; }));
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const { data: conn } = await sb.from("xero_connections").select("id, tenant_id, access_token, refresh_token, expires_at").order("updated_at", { ascending: false }).limit(1).single();
let at = conn.access_token;
if (!conn.expires_at || new Date(conn.expires_at).getTime() < Date.now() + 120_000) {
  const res = await fetch("https://identity.xero.com/connect/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", Authorization: "Basic " + Buffer.from(`${env.XERO_CLIENT_ID}:${env.XERO_CLIENT_SECRET}`).toString("base64") }, body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: conn.refresh_token }) });
  const tok = await res.json(); if (!res.ok) { console.error("refresh failed", JSON.stringify(tok)); process.exit(1); }
  at = tok.access_token;
  await sb.from("xero_connections").update({ access_token: tok.access_token, refresh_token: tok.refresh_token ?? conn.refresh_token, expires_at: new Date(Date.now() + (tok.expires_in ?? 1800) * 1000).toISOString(), updated_at: new Date().toISOString() }).eq("id", conn.id);
}
let calls = 0;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let lastCall = 0;
const xero = async (method, path, body, attempt = 0) => {
  const wait = 1100 - (Date.now() - lastCall); if (wait > 0) await sleep(wait); lastCall = Date.now();
  calls++;
  const r = await fetch(`https://api.xero.com/api.xro/2.0/${path}`, { method, headers: { Authorization: `Bearer ${at}`, "Xero-tenant-id": conn.tenant_id, Accept: "application/json", "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch {}
  if (r.status === 429 && attempt < 3) { const ra = Number(r.headers.get("retry-after") || 60); console.log(`    … 429, waiting ${ra}s`); await sleep((ra + 1) * 1000); return xero(method, path, body, attempt + 1); }
  if (!r.ok) throw new Error(`${method} ${path} ${r.status}: ${(j?.Elements?.[0]?.ValidationErrors?.map((e) => e.Message).join("; ") || j?.Message || t).slice(0, 300)}`);
  return j;
};
const T = JSON.parse(readFileSync(new URL("./xero-rec-today.json", import.meta.url), "utf8"));
const acct = (code) => T.accounts.find((a) => a.code === code).id;
const A602 = acct("602"), A604 = acct("604"), A607 = acct("607");
import { existsSync } from "node:fs";
const prev = existsSync(new URL("./rec-post-2026-10-06.json", import.meta.url)) ? JSON.parse(readFileSync(new URL("./rec-post-2026-10-06.json", import.meta.url), "utf8")) : { created: [] };
const prevCreated = (prev.created || []).filter((c) => c.kind !== "FAILED");
const doneFee = new Set(prevCreated.filter((c) => c.kind === "gc_fee").map((c) => c.date));
const doneSpend = new Set(prevCreated.filter((c) => c.kind === "spend").map((c) => `${c.date}|${c.who}|${c.total}|${c.from}`));
const doneTransfer = new Set(prevCreated.filter((c) => c.kind === "transfer").map((c) => `${c.date}|${c.amt}|${c.to}`));
const log = []; const out = { at: new Date().toISOString(), posted: POST, created: [...prevCreated] };
const plan = (kind, desc, fn) => log.push({ kind, desc, fn });
const invCache = {};
const getInv = async (no) => invCache[no] ??= (await xero("GET", `Invoices/${no}`)).Invoices[0];

// ---------- A. customer receipts → invoice payments in 602 ----------
const receipts = [
  ["2026-09-28", "INV-6984", 746.35, "Just Focus / Snap Fitness Bellmere"],
  ["2026-09-29", "INV-6796", 129, "Snap Fitness Casuarina NT"],
  ["2026-09-29", "INV-6555", 36.85, "Snap Fitness Armadale WA (1/2, bank ref INV-6877 $73.70)"],
  ["2026-09-29", "INV-6877", 36.85, "Snap Fitness Armadale WA (2/2)"],
  ["2026-09-30", "INV-6946", 60.5, "Leichhardt Fitness Centre"],
  ["2026-09-30", "INV-6947", 139, "Leichhardt Fitness Centre"],
  ["2026-09-30", "INV-6948", 24.75, "Leichhardt Fitness Centre"],
  ["2026-09-30", "INV-6987", 120.84, "TFBL Unit Trust (bank ref CBA INV-6987)"],
  ["2026-09-30", "INV-6978", 120.84, "Total Fusion Morningside"],
  ["2026-09-30", "INV-6872", 60.5, "Snap Fitness Oxenford (1/2, bank $85.25)"],
  ["2026-09-30", "INV-6873", 24.75, "Snap Fitness Oxenford (2/2)"],
  ["2026-10-01", "INV-6981", 139, "BW Fitness / Snap Fitness Noosa"],
  ["2026-10-01", "INV-6929", 60.5, "Snap Fitness Willetton (1/2, bank ref INV-6930 $85.25)"],
  ["2026-10-01", "INV-6930", 24.75, "Snap Fitness Willetton (2/2)"],
  ["2026-10-02", "INV-6783", 60.5, "Snap Fitness Traralgon (1/2, bank $189.50)"],
  ["2026-10-02", "INV-6992", 129, "Snap Fitness Traralgon (2/2)"],
  ["2026-10-05", "INV-7042", 278, "Snap Fitness Heidelberg"],
  ["2026-10-05", "INV-6455", 24.75, "Snap Fitness Port Melbourne (paid by CSM Business Group)"],
  ["2026-10-05", "INV-6850", 35.75, "Hege Pty Ltd / Snap Fitness Berwick"],
];
for (const [date, no, amt, who] of receipts) plan("A receipt", `${date} ${no} $${amt} ${who}`, async () => {
  const inv = await getInv(no);
  if (inv.Status === "PAID") return `already PAID → skip`;
  if (Math.abs(Number(inv.AmountDue) - amt) > 0.005) return `amount due is $${inv.AmountDue}, expected $${amt} → SKIP, needs a look`;
  if (!POST) return "would pay";
  const j = await xero("PUT", "Payments", { Payments: [{ Invoice: { InvoiceID: inv.InvoiceID }, Account: { AccountID: A602 }, Date: date, Amount: amt, Reference: `Bank rec 6 Oct — ${who}` }] });
  out.created.push({ kind: "receipt", id: j.Payments[0].PaymentID, no, amt, date }); return j.Payments[0].PaymentID;
});

// ---------- B. GoCardless payouts → batch deposit + fee spend ----------
const gc = [
  { date: "2026-09-29", net: 136.86, fee: 2.14, inv: { "INV-6979": 139 } },
  { date: "2026-09-30", net: 968.88, fee: 15.37, inv: { "INV-7001": 260, "INV-6997": 71.5, "INV-6994": 379, "INV-6995": 139, "INV-6991": 24.75, "INV-6990": 60.5, "INV-6996": 24.75, "INV-6937": 24.75 } },
  { date: "2026-10-01", net: 393.21, fee: 5.79, inv: { "INV-7004": 163.75, "INV-7006": 235.25 } },
  { date: "2026-10-02", net: 370.84, fee: 5.91, inv: { "INV-7007": 139, "INV-7012": 131.25, "INV-7008": 106.5 } },
  { date: "2026-10-05", net: 662.61, fee: 11.24, inv: { "INV-7022": 146.85, "INV-7028": 139, "INV-7024": 139, "INV-6894": 24.75, "INV-7027": 139, "INV-7026": 24.75, "INV-7018": 60.5 } },
];
for (const p of gc) {
  const gross = +(p.net + p.fee).toFixed(2); const sum = +Object.values(p.inv).reduce((s, v) => s + v, 0).toFixed(2);
  plan("B GC batch", `${p.date} payout net $${p.net} = ${Object.keys(p.inv).length} invoices $${sum} − fee $${p.fee}`, async () => {
    if (Math.abs(sum - gross) > 0.005) return `invoice sum $${sum} ≠ gross $${gross} → SKIP`;
    const invs = []; for (const [no, amt] of Object.entries(p.inv)) { const inv = await getInv(no); if (inv.Status === "PAID") return `${no} already PAID → SKIP whole payout, needs a look`; if (Math.abs(Number(inv.AmountDue) - amt) > 0.005) return `${no} due $${inv.AmountDue} ≠ $${amt} → SKIP whole payout`; invs.push([inv, amt]); }
    if (!POST) return "would batch";
    const j = await xero("PUT", "BatchPayments", { BatchPayments: [{ Type: "RECBATCH", Account: { AccountID: A602 }, Date: p.date, Reference: `GoCardless payout ${p.date}`, Payments: invs.map(([inv, amt]) => ({ Invoice: { InvoiceID: inv.InvoiceID }, Amount: amt })) }] });
    const bp = j.BatchPayments[0]; out.created.push({ kind: "gc_batch", id: bp.BatchPaymentID, date: p.date, total: bp.TotalAmount }); return `batch ${bp.BatchPaymentID} $${bp.TotalAmount}`;
  });
  plan("B GC fee", `${p.date} GoCardless fee $${p.fee} → 446 INPUT`, async () => {
    if (doneFee.has(p.date)) return "created in an earlier run → skip";
    if (!POST) return "would spend";
    const j = await xero("PUT", "BankTransactions", { BankTransactions: [{ Type: "SPEND", Contact: { Name: "GoCardless" }, Date: p.date, Reference: `GoCardless payout fee ${p.date}`, BankAccount: { AccountID: A602 }, LineAmountTypes: "Inclusive", LineItems: [{ Description: `GoCardless fees on payout ${p.date}`, Quantity: 1, UnitAmount: p.fee, AccountCode: "446", TaxType: "INPUT" }] }] });
    out.created.push({ kind: "gc_fee", id: j.BankTransactions[0].BankTransactionID, date: p.date, fee: p.fee }); return j.BankTransactions[0].BankTransactionID;
  });
}

// ---------- C. drafts → approve; bills → pay ----------
const approve = async (id, { contact, code, tax, desc }) => {
  const inv = (await xero("GET", `Invoices/${id}`)).Invoices[0];
  if (inv.Status !== "DRAFT") return { inv, note: `already ${inv.Status}` };
  if (!POST) return { inv, note: "would approve" };
  const body = { InvoiceID: id, Status: "AUTHORISED", LineItems: inv.LineItems.map((l) => ({ ...l, Description: l.Description || desc, AccountCode: code, TaxType: tax })) };
  if (contact) body.Contact = { Name: contact };
  const j = await xero("POST", `Invoices/${id}`, { Invoices: [body] });
  out.created.push({ kind: "approved", id, contact: contact || inv.Contact?.Name }); return { inv: j.Invoices[0], note: "approved" };
};
const payBill = async (id, date, amt, from, label, extra = {}) => {
  const inv = (await xero("GET", `Invoices/${id}`)).Invoices[0];
  if (inv.Status === "PAID") return "already PAID → skip";
  if (inv.Status !== "AUTHORISED") return `status ${inv.Status} → SKIP`;
  if (!POST) return "would pay";
  const j = await xero("PUT", "Payments", { Payments: [{ Invoice: { InvoiceID: id }, Account: { AccountID: from }, Date: date, Amount: amt, Reference: `Bank rec 6 Oct — ${label}`, ...extra }] });
  out.created.push({ kind: "billpayment", id: j.Payments[0].PaymentID, label, amt, date }); return j.Payments[0].PaymentID;
};
const draftsThenPay = [
  { id: "2744e7fe-0871-4bb2-80a3-c2dabe11cf5d", label: "MYOB 3-10001491910 $2.50", code: "485", tax: "INPUT", desc: "MYOB subscription", date: "2026-10-01", amt: 2.5, from: A602 },
  { id: "1bebb152-430a-452b-9c2d-2b6909b59789", label: "Uber $21.18 (was No Contact)", contact: "Uber", code: "493", tax: "INPUT", desc: "Uber trip", date: "2026-10-01", amt: 21.18, from: A602 },
  { id: "24990878-d822-43ff-bc9b-6749d1e48f61", label: "Uber $16.02", code: "493", tax: "INPUT", desc: "Uber trip", date: "2026-10-05", amt: 16.02, from: A602 },
  { id: "6c6ea383-0705-41fc-a2e4-141122836fe4", label: "Bunnings Morayfield $7.59", code: "341", tax: "INPUT", desc: "Bunnings Morayfield", date: "2026-09-25", amt: 7.59, from: A604 },
  { id: "70eb151f-b684-4238-9bdb-f3c2504a3766", label: "Arko Caboolture $176.02 (was No Contact)", contact: "Arko", code: "341", tax: "INPUT", desc: "Arko Caboolture — EFTPOS 25 Sep", date: "2026-09-25", amt: 176.02, from: A604 },
];
for (const d of draftsThenPay) plan("C approve+pay", `${d.label} → ${d.code} ${d.tax}, pay ${d.date} from ${d.from === A602 ? "602" : "604"}`, async () => { const a = await approve(d.id, d); if (!POST) return a.note; const p = await payBill(d.id, d.date, d.amt, d.from, d.label); return `${a.note}; ${p}`; });
const bills = [
  ["5a01c17f-b099-42cf-89e9-ad4a2cc1b451", "2026-10-05", 1205.73, A602, "Workcover QLD $1,205.73"],
  ["4d4f1037-df82-460a-8d06-75dba7ec40cf", "2026-09-28", 72.4, A604, "Reddy Express Pimpama $72.40"],
  ["790b3611-187b-4a23-a5e4-9459bbad3802", "2026-09-28", 108.65, A604, "Europcar 101321203649 $108.65"],
  ["38033da7-fbd1-4b71-8788-a1377de8b6d0", "2026-09-28", 102.83, A604, "BP Upper Coomera $102.83"],
  ["21d41bf0-c9d1-4e64-b179-33ebedd67572", "2026-09-28", 67.48, A604, "BP Nambucca $67.48"],
  ["c84e3a58-b78d-40da-88f9-062dc0c63f29", "2026-09-28", 67.1, A604, "Australia Post Caboolture $67.10"],
  ["be93c179-dea7-498d-bc36-42405c586d9c", "2026-09-28", 14.98, A604, "Bunnings Newstead $14.98"],
];
for (const [id, date, amt, from, label] of bills) plan("C bill payment", `${date} ${label} from ${from === A602 ? "602" : "604"}`, () => payBill(id, date, amt, from, label));
// Topton: USD 13,980 bill, AUD 20,132.49 left the account 28 Sep → CurrencyRate = USD per AUD (same convention as the Highland Park NZD payments)
const TOPTON_USD = 13980, TOPTON_AUD = 20132.49, TOPTON_RATE = +(TOPTON_USD / TOPTON_AUD).toFixed(6);
plan("C bill payment", `2026-09-28 Topton C0923FW USD ${TOPTON_USD} at ${TOPTON_RATE} = AUD ${TOPTON_AUD} from 602 (Centrefit purchase, 20 Veyla Protect PCs)`, () => payBill("f456b01f-a42d-463d-b466-9464ffe75708", "2026-09-28", TOPTON_USD, A602, "Topton C0923FW — AUD 20,132.49 sent", { CurrencyRate: TOPTON_RATE }));

// ---------- D. spend money on 602 ----------
plan("D account", `create 844 "Loan - AMO Car Finance N13248660" (CURRLIAB) if missing`, async () => {
  const j = await xero("GET", `Accounts?where=${encodeURIComponent('Code=="844"')}`);
  if (j.Accounts?.length) return `exists: ${j.Accounts[0].Name}`;
  if (!POST) return "would create";
  const c = await xero("PUT", "Accounts", { Code: "844", Name: "Loan - AMO Car Finance N13248660", Type: "CURRLIAB", Description: "AMO vehicle finance — repayments; interest split per the loan schedule (accountant)", TaxType: "BASEXCLUDED" });
  out.created.push({ kind: "account", id: c.Accounts?.[0]?.AccountID, code: "844" }); return "created";
});
const spend = (from, rows) => { for (const [date, who, lines, ref] of rows) { const total = +lines.reduce((s, l) => s + l[0], 0).toFixed(2); plan(`${from === A602 ? "D" : "F"} spend ${from === A602 ? "602" : "604"}`, `${date} ${who} $${total} → ${lines.map((l) => `${l[1]} ${l[2]}`).join(" + ")}`, async () => {
  if (doneSpend.has(`${date}|${who}|${total}|${from === A602 ? "602" : "604"}`)) return "created in an earlier run → skip";
  if (!POST) return "would spend";
  const j = await xero("PUT", "BankTransactions", { BankTransactions: [{ Type: "SPEND", Contact: { Name: who }, Date: date, Reference: ref || who, BankAccount: { AccountID: from }, LineAmountTypes: "Inclusive", LineItems: lines.map(([amt, code, tax, desc]) => ({ Description: desc || ref || who, Quantity: 1, UnitAmount: amt, AccountCode: code, TaxType: tax })) }] });
  out.created.push({ kind: "spend", id: j.BankTransactions[0].BankTransactionID, who, total, date, from: from === A602 ? "602" : "604" }); return j.BankTransactions[0].BankTransactionID;
}); } };
spend(A602, [
  ["2026-09-29", "CentreFit", [[6161.1, "804", "BASEXCLUDED", "Weekly wages 29 Sep 2026"]], "Weekly wages"],
  ["2026-09-28", "Nissan Financial", [[205.98, "843", "BASEXCLUDED", "Nissan Financial repayment 00644709C055459734"]], "Nissan Financial repayment"],
  ["2026-10-05", "Nissan Financial", [[198.98, "843", "BASEXCLUDED", "Nissan Financial repayment 00644709C055525866"]], "Nissan Financial repayment"],
  ["2026-10-01", "Get Capital", [[572.18, "840", "BASEXCLUDED", "Shift (Get Capital) chattel mortgage LPT-005297699"]], "Shift debit LPT-005297699"],
  ["2026-10-02", "Linkt", [[100, "451", "INPUT", "Linkt tolls top-up 961676970371"]], "Linkt tolls"],
  ["2026-09-28", "Youi", [[278.44, "449", "INPUT", "Youi premium"]], "Youi premium"],
  ["2026-10-05", "Youi", [[146.41, "449", "INPUT", "Youi premium"]], "Youi premium"],
  ["2026-10-05", "Uber", [[36.31, "493", "INPUT", "Uber trip"]], "Uber trip"],
  ["2026-10-05", "Uber", [[26.96, "493", "INPUT", "Uber trip"]], "Uber trip"],
  ["2026-09-28", "Beefy's Glass House Mountains", [[17.12, "306", "INPUT", "Beefy's Glass House Mountains — meal"]], "Beefy's"],
  ["2026-10-05", "Xero Australia", [[143, "485", "INPUT", "Xero subscription XEROAUINV_VNFQLZNZ"]], "Xero subscription"],
  ["2026-09-30", "AMO", [[1159.76, "844", "BASEXCLUDED", "AMO car finance repayment N13248660"]], "AMO loan N13248660"],
  ["2026-09-28", "Shenzhen Baoshihang International Freight Forwarding", [[3889.21, "341", "BASEXCLUDED", "Modulators, splitters, leads, power supplies — international transfer 672549"]], "Intl transfer 672549"],
  ["2026-10-05", "PCB Way", [[1276.72, "341", "BASEXCLUDED", "PCBWay order YV1819924 — USD 881.19"], [38.3, "406", "BASEXCLUDED", "ANZ overseas transaction fee"]], "PCBWay YV1819924"],
]);

// ---------- E. transfers ----------
for (const [date, amt, to, toCode] of [["2026-09-28", 4000, A607, "607"], ["2026-10-02", 1000, A604, "604"], ["2026-10-02", 1000, A607, "607"]]) plan("E transfer", `${date} $${amt} 602 → ${toCode}`, async () => {
  if (doneTransfer.has(`${date}|${amt}|${toCode}`)) return "created in an earlier run → skip";
  if (!POST) return "would transfer";
  const j = await xero("PUT", "BankTransfers", { BankTransfers: [{ FromBankAccount: { AccountID: A602 }, ToBankAccount: { AccountID: to }, Amount: amt, Date: date }] });
  out.created.push({ kind: "transfer", id: j.BankTransfers[0].BankTransferID, amt, date, to: toCode }); return j.BankTransfers[0].BankTransferID;
});

// ---------- F. spend money on 604 (tech cards) ----------
spend(A604, [
  ["2026-09-21", "Newvista Holdings", [[18.95, "306", "INPUT", "Newvista Holdings Waurn Ponds — meal"]]],
  ["2026-09-21", "Norris Motor Group", [[361, "448", "INPUT", "Norris Motor Group Brendale — vehicle service"]]],
  ["2026-09-23", "BP", [[131.97, "447", "INPUT", "BP Slacks Creek — fuel"]]],
  ["2026-09-28", "JB Hi Fi", [[998, "341", "INPUT", "JB Hi-Fi Kedron"]]],
  ["2026-09-28", "Norris Motor Group", [[480, "448", "INPUT", "Norris Motor Group Brendale — vehicle service"]]],
  ["2026-09-28", "BP", [[179.11, "447", "INPUT", "BP Brendale — fuel"]]],
  ["2026-09-28", "BAC parking", [[69, "451", "INPUT", "BAC Parking Ascot"]]],
  ["2026-09-29", "Milton Central Parking", [[40, "451", "INPUT", "Milton Central Parking"]]],
  ["2026-09-29", "Cellopark", [[20.55, "451", "INPUT", "BCC Cellopark on-street parking"]]],
  ["2026-09-29", "Cellopark", [[1.99, "451", "INPUT", "Cellopark fee"]]],
  ["2026-09-29", "Bunnings Warehouse", [[61.04, "341", "INPUT", "Bunnings Carseldine"]]],
  ["2026-09-30", "Jaycar", [[27.05, "341", "INPUT", "Jaycar Strathpine"]]],
  ["2026-10-02", "Haymans Electrical", [[36.41, "341", "INPUT", "Haymans Electrical Maroochydore"]]],
  ["2026-10-02", "Adapt-A-Lift Group", [[417.29, "427", "INPUT", "Adapt-A-Lift — equipment hire"]]],
  ["2026-10-02", "Google", [[100, "402", "INPUT", "Google Ads 3095152396"]]],
  ["2026-10-02", "Google", [[15, "402", "INPUT", "Google Ads 3095152396"]]],
  ["2026-10-05", "Google", [[250, "402", "INPUT", "Google Ads 3095152396"]]],
  ["2026-10-05", "Google", [[38.09, "402", "INPUT", "Google Ads 3095152396"]]],
  ["2026-10-05", "Amazon", [[30.72, "341", "INPUT", "Amazon Marketplace AU"]]],
  ["2026-10-05", "Amazon", [[16.99, "341", "INPUT", "Amazon Marketplace AU"]]],
  ["2026-10-05", "Ampol", [[93.71, "447", "INPUT", "Ampol Lawnton — fuel"]]],
  ["2026-10-05", "Bunnings Warehouse", [[12.74, "341", "INPUT", "Bunnings Carseldine"]]],
]);

// ---------- G. delete the PCBWay draft keyed in USD ----------
plan("G delete draft", `No Contact YV1819924 $881.19 (PCBWay, USD figure keyed as AUD — replaced by the $1,315.02 spend)`, async () => {
  const inv = (await xero("GET", `Invoices/1cbb99f2-8ab1-46d9-8380-dbc8e98a0d63`)).Invoices[0];
  if (inv.Status !== "DRAFT") return `status ${inv.Status} → skip`;
  if (!POST) return "would delete";
  await xero("POST", `Invoices/1cbb99f2-8ab1-46d9-8380-dbc8e98a0d63`, { Invoices: [{ InvoiceID: inv.InvoiceID, Status: "DELETED" }] });
  out.created.push({ kind: "deleted_draft", id: inv.InvoiceID }); return "deleted";
});

console.log(`${POST ? "POSTING" : "DRY RUN"}: ${log.length} actions\n`);
let ok = 0, failed = 0, skipped = 0;
for (const a of log) {
  try { const r = await a.fn(); if (/SKIP|skip/.test(String(r))) skipped++; else ok++; console.log(`  ${POST ? "✓" : "·"} ${a.kind.padEnd(16)} ${a.desc} → ${r}`); }
  catch (e) { failed++; console.log(`  ✗ ${a.kind.padEnd(16)} ${a.desc} → ${e.message.slice(0, 240)}`); out.created.push({ kind: "FAILED", desc: a.desc, error: e.message.slice(0, 300) }); }
}
console.log(`\n${POST ? "posted" : "dry run"}: ok ${ok}, skipped ${skipped}, failed ${failed}, Xero calls ${calls}`);
if (POST) {
  writeFileSync(new URL("./rec-post-2026-10-06.json", import.meta.url), JSON.stringify(out, null, 2));
  await sb.from("finance_agent_actions").insert({ actor: "cortex", action: "bank_rec.pre_record", entity: "xero", entity_id: "602+604", after: { ok, skipped, failed, created: out.created.length }, rule: "Mitchell OK 6 Oct (in flight): 'the rest send it'", note: "Rec 21 Sep–5 Oct: receipts, GC batches 29 Sep–5 Oct, bill payments incl. Topton USD, spend money 602+604, transfers, PCBWay draft deleted. Left: Shift $40k, Airwave, DWP double payment, Vermont South/28 Sep GC payout, Stripe Find & Match." }).then(({ error }) => error && console.log("audit row failed:", error.message));
}
