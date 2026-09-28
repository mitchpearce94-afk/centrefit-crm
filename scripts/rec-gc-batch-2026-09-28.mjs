// WRITES: replaces the individual GoCardless invoice payments (22–25 Sep) with ONE batch deposit per payout in 602, so Find & Match = batch + fee.
import { readFileSync, writeFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
const env = Object.fromEntries(readFileSync(new URL("../.env.gc-probe", import.meta.url), "utf8").split("\n").filter((l) => l.includes("=")).map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, "").replace(/\\r|\\n/g, "").replace(/\r|\n/g, "").trim()]; }));
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const { data: conn } = await sb.from("xero_connections").select("tenant_id, access_token").order("updated_at", { ascending: false }).limit(1).single();
const H = { Authorization: `Bearer ${conn.access_token}`, "Xero-tenant-id": conn.tenant_id, Accept: "application/json", "Content-Type": "application/json" };
const x = async (m, p, b) => { const r = await fetch("https://api.xero.com/api.xro/2.0/" + p, { method: m, headers: H, body: b ? JSON.stringify(b) : undefined }); const t = await r.text(); if (!r.ok) throw new Error(`${m} ${p.split("?")[0]} ${r.status} ${t.slice(0, 250)}`); return JSON.parse(t); };
const T = JSON.parse(readFileSync(new URL("./xero-rec-today.json", import.meta.url), "utf8")); const acct602 = T.accounts.find((a) => a.code === "602").id;
const payouts = {
  "2026-09-23": { net: 1710.32, fee: 26.92, inv: ["INV-6940", "INV-6917", "INV-6928", "INV-6938", "INV-6961", "INV-6963", "INV-6958", "INV-6957", "INV-6959", "INV-6960", "INV-6966", "INV-6964", "INV-6962"] },
  "2026-09-24": { net: 508.38, fee: 8.47, inv: ["INV-6768", "INV-6769", "INV-6974", "INV-6973", "INV-6972"] },
  "2026-09-25": { net: 196.2, fee: 3.3, inv: ["INV-6975", "INV-6977"] },
};
const out = {};
for (const [date, p] of Object.entries(payouts)) {
  const invs = []; for (const no of p.inv) { const j = await x("GET", `Invoices/${no}`); invs.push(j.Invoices[0]); }
  // delete the individual payments I recorded today on these invoices (unreconciled, dated today's rec), then batch
  let removed = 0, kept = [];
  for (const i of invs) for (const pm of i.Payments || []) { if (pm.IsReconciled) { kept.push(`${i.InvoiceNumber} ${pm.Amount} (reconciled, left)`); continue; } if (!/Bank rec 28 Sep|GoCardless payout/.test(pm.Reference || "")) { kept.push(`${i.InvoiceNumber} ${pm.Amount} (not mine, left)`); continue; } await x("POST", `Payments/${pm.PaymentID}`, { Payments: [{ PaymentID: pm.PaymentID, Status: "DELETED" }] }); removed++; }
  const gross = +(p.net + p.fee).toFixed(2); const sum = +invs.reduce((s, i) => s + Number(i.Total), 0).toFixed(2);
  if (Math.abs(sum - gross) > 0.005) { console.log(`✗ ${date}: invoices sum ${sum} ≠ gross ${gross} — not batched`); out[date] = { error: "sum mismatch", sum, gross }; continue; }
  const b = await x("PUT", "BatchPayments", { BatchPayments: [{ Type: "RECBATCH", Account: { AccountID: acct602 }, Date: date, Reference: `GoCardless payout ${date}`, Payments: invs.map((i) => ({ Invoice: { InvoiceID: i.InvoiceID }, Amount: Number(i.Total) })) }] });
  const bp = b.BatchPayments[0]; out[date] = { batch: bp.BatchPaymentID, total: bp.TotalAmount, payments: (bp.Payments || []).map((q) => q.PaymentID), removed, kept };
  console.log(`✓ ${date}: batch deposit $${bp.TotalAmount} (${p.inv.length} invoices) + fee spend $${p.fee} = net $${p.net} | removed ${removed} single payments${kept.length ? " | kept: " + kept.join("; ") : ""}`);
  await sb.from("finance_payouts").update({ posted: { batch_id: bp.BatchPaymentID, payment_ids: out[date].payments, by: "cortex", at: new Date().toISOString(), note: "batch deposit + fee spend; Mitchell ticks two items in Find & Match" }, updated_at: new Date().toISOString() }).eq("arrival_date", date).eq("provider", "gocardless");
}
writeFileSync(new URL("./rec-gc-batch-2026-09-28.json", import.meta.url), JSON.stringify(out, null, 2));
await sb.from("finance_agent_actions").insert({ actor: "cortex", action: "bank_rec.gc_batch_deposits", entity: "xero", entity_id: "602", after: out, rule: "Mitchell 28 Sep", note: "GC payouts 22–25 Sep as one batch deposit each" });
