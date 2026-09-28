// Matches an ANZ statement export (date,amount,description) for 602 against the Xero-side movements in scripts/xero-rec-lines.json.
// Output per line: DONE (matched a reconciled Xero item) / GREEN (matched an unreconciled one — one-click OK in Xero) / TODO (proposal).
// Usage: node scripts/rec-match-anz.mjs <anz.csv> [sinceYYYY-MM-DD]. Writes scripts/rec-match-anz.json + prints the TODO/GREEN lists. Read-only.
import { readFileSync, writeFileSync } from "node:fs";
const [csvPath, since = "2026-07-30"] = process.argv.slice(2);
const X = JSON.parse(readFileSync(new URL("./xero-rec-lines.json", import.meta.url), "utf8"));
const T = JSON.parse(readFileSync(new URL("./xero-rec-today.json", import.meta.url), "utf8"));
const CC = JSON.parse(readFileSync(new URL("./finance-payout-crosscheck.json", import.meta.url), "utf8"));
const lines = readFileSync(csvPath, "utf8").replace(/^﻿/, "").split(/\r?\n/).filter(Boolean).map((l) => { const m = /^(\d{2})\/(\d{2})\/(\d{4}),"?(-?[\d.]+)"?,(.*)$/.exec(l); return m ? { date: `${m[3]}-${m[2]}-${m[1]}`, amount: Number(m[4]), desc: m[5].replace(/\s+/g, " ").trim() } : null; }).filter(Boolean).filter((l) => l.date >= since).sort((a, b) => a.date.localeCompare(b.date));
const days = (a, b) => Math.round((new Date(b) - new Date(a)) / 86400e3);
const eq = (a, b) => Math.abs(a - b) < 0.005;
// candidate pool: one-to-one consumption
const pool = [
  ...X.tx.map((t) => ({ ...t, label: `${t.type} ${t.contact} ${t.ref} [${t.lines}]` })),
  ...X.billpay.filter((p) => !p.batch).map((p) => ({ ...p, label: `bill ${p.contact} ${p.ref}` })),
  ...X.invpay.filter((p) => !p.batch).map((p) => ({ ...p, label: `invoice ${p.contact} ${p.ref}` })),
  ...X.batches.filter((b) => b.account === "602" || !b.account).map((b) => ({ ...b, label: `${b.type} ${b.n} items ${b.ref}` })),
].map((c) => ({ ...c, used: false }));
const take = (amount, date, lo = -6, hi = 6) => {
  const cands = pool.filter((c) => !c.used && eq(c.amount, amount) && days(c.date, date) >= lo && days(c.date, date) <= hi).sort((a, b) => Math.abs(days(a.date, date)) - Math.abs(days(b.date, date)) || (b.rec ? 1 : 0) - (a.rec ? 1 : 0));
  if (cands.length) { cands[0].used = true; return cands[0]; }
  return null;
};
// group matches: several invoice payments on one day summing to a receipt (customer paid two invoices in one transfer)
const takeGroup = (amount, date, contactHint) => {
  const same = pool.filter((c) => !c.used && c.kind === "invpay" && Math.abs(days(c.date, date)) <= 3 && c.amount > 0 && c.amount < amount + 0.005);
  const hint = contactHint ? same.filter((c) => c.contact.toLowerCase().includes(contactHint)) : same;
  for (const set of [hint, same]) {
    for (let i = 0; i < set.length; i++) for (let j = i + 1; j < set.length; j++) { if (eq(set[i].amount + set[j].amount, amount)) { set[i].used = set[j].used = true; return [set[i], set[j]]; } for (let k = j + 1; k < set.length; k++) if (eq(set[i].amount + set[j].amount + set[k].amount, amount)) { set[i].used = set[j].used = set[k].used = true; return [set[i], set[j], set[k]]; } }
  }
  return null;
};
const bills = T.bills, invoices = T.invoices;
const gcNet = CC.rows.map((r) => ({ date: r.date, net: r.net, gross: r.gross, id: r.id, verdict: r.verdict }));
const out = [];
for (const l of lines) {
  const d = l.desc.toUpperCase();
  const m = take(l.amount, l.date);
  if (m) { out.push({ ...l, status: m.rec ? "DONE" : "GREEN", via: m.label, xero: m.kind, xeroDate: m.date }); continue; }
  const hint = (/(?:FROM|TO) ([A-Z0-9 .&'\-]+?)(?: PTY| ATF| INV| SNAP| \d|$)/.exec(d) || [])[1]?.toLowerCase()?.split(" ")[0];
  const g = l.amount > 0 ? takeGroup(l.amount, l.date, hint) : null;
  if (g) { out.push({ ...l, status: g.every((x) => x.rec) ? "DONE" : "GREEN", via: g.map((x) => x.label).join(" + "), xero: "invpay×" + g.length, xeroDate: g[0].date }); continue; }
  // proposals
  let proposal = "";
  const gc = gcNet.find((p) => eq(p.net, l.amount) && Math.abs(days(p.date, l.date)) <= 2);
  if (/STRIPE/.test(d)) proposal = "Stripe payout: Xero's Stripe feed normally shows this green — OK it. If not, Find & Match the Stripe invoice payments + fee lines for the charge dates.";
  else if (gc) proposal = `GoCardless payout ${gc.date} (gross $${gc.gross.toFixed(2)}): Find & Match the customer invoices + bank-fee adjustment $${(gc.gross - gc.net).toFixed(2)} to 446 (${gc.verdict.split(" (")[0]} in CRM).`;
  else if (/MULTI-PAY/.test(d) && l.amount < 0) { const b = X.batches.find((b) => eq(b.amount, l.amount)); proposal = b ? `Find & Match batch ${b.date} (${b.n} bills)${b.rec ? " — batch already reconciled elsewhere?" : ""}` : (Math.abs(l.amount) > 4000 && Math.abs(l.amount) < 9000 ? "Weekly WAGES → Create: contact CentreFit, 804 Wages Payable, BAS Excluded." : "Supplier multi-pay with no Xero batch — build the batch (which bills?) then Find & Match."); }
  else if (/\bATO\b|TAX OFFICE/.test(d)) proposal = "ATO → Create: contact ATO, 829 ATO Integrated Client Account, BAS Excluded.";
  else if (/SUPERCHOICE/.test(d)) proposal = "Super clearing house → Create: 827 Super Payable (or match the pay-run super batch), BAS Excluded.";
  else if (/TFER TRANSFER .* TO 0142714|FUNDS TFER TRANSFER/.test(d)) proposal = "Own-account move → Transfer to the matching CF account (603 GST Holdings unless the number says otherwise).";
  else if (/DISPUTES/.test(d)) proposal = "ANZ disputes credit → check the disputed card charge; Create to the original expense account (reverse), BAS per original.";
  else if (/ACCOUNT SERVICING FEE|FEE/.test(d)) proposal = "Bank fee → Create: 404 Bank Fees, BAS Excluded.";
  else if (/NISSAN FINANCIAL/.test(d)) proposal = "Vehicle finance → match the loan schedule: principal to the liability account + interest to 437 (per accountant's split).";
  else if (/SHIFT DEBIT/.test(d)) proposal = "Shift (finance) debit → liability/interest split as per prior months (copy last month's coding).";
  else if (/LINKT/.test(d)) proposal = "Tolls → Create: 449 Motor Vehicles - Tolls (or the account used last month), GST on expenses.";
  else if (/PAYMENT (?:FROM|TO) (Mich|Mitc|Sue Ca|Mark)/i.test(l.desc)) proposal = "Reimbursement / wages top-up → check: if a payroll amount, 804 Wages Payable BAS Excluded; if an expense reimbursement, the expense account.";
  else if (l.amount > 0) {
    const inv = (/INV[- ]?(\d{4,5})/.exec(d) || [])[1];
    const cands = invoices.filter((i) => eq(i.amountDue, l.amount) || (inv && String(i.number).endsWith(inv)));
    proposal = cands.length ? `Customer receipt → Find & Match ${cands.map((c) => `${c.number} ${c.contact} $${c.amountDue}`).join(" | ")}` : `Customer receipt — no awaiting invoice for $${l.amount}${inv ? ` (ref INV-${inv})` : ""}: check the customer's invoices / part payment.`;
  } else {
    const cands = bills.filter((b) => eq(b.amountDue, -l.amount) || eq(b.total, -l.amount));
    proposal = cands.length ? `Find & Match bill ${cands.map((c) => `${c.contact} ${c.number} $${c.amountDue}`).join(" | ")}` : (/VISA DEBIT|EFTPOS/.test(d) ? "Card purchase with no bill/spend in Xero → Create spend money (supplier from the description) or attach the receipt via Receipts Snap." : "No Xero item — decide: bill to match, spend money to create, or transfer.");
  }
  out.push({ ...l, status: "TODO", proposal });
}
const by = { DONE: 0, GREEN: 0, TODO: 0 }; for (const o of out) by[o.status]++;
writeFileSync(new URL("./rec-match-anz.json", import.meta.url), JSON.stringify({ at: new Date().toISOString(), since, counts: by, rows: out }, null, 2));
console.log(`lines ${out.length} since ${since}: DONE ${by.DONE}, GREEN ${by.GREEN}, TODO ${by.TODO}\n`);
console.log("GREEN (matched, waiting for your OK in Xero):"); for (const o of out.filter((o) => o.status === "GREEN")) console.log(`  ${o.date} ${String(o.amount).padStart(10)}  ${o.desc.slice(0, 48).padEnd(48)} → ${o.via.slice(0, 70)}`);
console.log("\nTODO:"); for (const o of out.filter((o) => o.status === "TODO")) console.log(`  ${o.date} ${String(o.amount).padStart(10)}  ${o.desc.slice(0, 48).padEnd(48)} → ${o.proposal}`);
const unusedUnrec = pool.filter((c) => !c.used && !c.rec); console.log(`\nXero-side unreconciled items NOT hit by any statement line: ${unusedUnrec.length}`); for (const c of unusedUnrec) console.log(`  ${c.date} ${String(c.amount).padStart(10)}  ${c.label.slice(0, 80)}`);
