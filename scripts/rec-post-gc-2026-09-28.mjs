// WRITES: records the 8 GoCardless payer payments (23/24 Sep payouts) in Xero 602, links the GC customers to their Xero contacts in the CRM,
// stamps the payout items, and marks the 23/24/25 Sep payouts as posted. Mitchell 28 Sep: "api into gocardless, look at the transaction and reconcile who the payments come from + the fee".
import { readFileSync, writeFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
const env = Object.fromEntries(readFileSync(new URL("../.env.gc-probe", import.meta.url), "utf8").split("\n").filter((l) => l.includes("=")).map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, "").replace(/\\r|\\n/g, "").replace(/\r|\n/g, "").trim()]; }));
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const { data: conn } = await sb.from("xero_connections").select("id, tenant_id, access_token, refresh_token, expires_at").order("updated_at", { ascending: false }).limit(1).single();
let at = conn.access_token;
if (!conn.expires_at || new Date(conn.expires_at).getTime() < Date.now() + 60_000) { const res = await fetch("https://identity.xero.com/connect/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", Authorization: "Basic " + Buffer.from(`${env.XERO_CLIENT_ID}:${env.XERO_CLIENT_SECRET}`).toString("base64") }, body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: conn.refresh_token }) }); const tok = await res.json(); if (!res.ok) { console.error("refresh failed"); process.exit(1); } at = tok.access_token; await sb.from("xero_connections").update({ access_token: tok.access_token, refresh_token: tok.refresh_token ?? conn.refresh_token, expires_at: new Date(Date.now() + (tok.expires_in ?? 1800) * 1000).toISOString(), updated_at: new Date().toISOString() }).eq("id", conn.id); }
const xero = async (method, path, body) => { const r = await fetch(`https://api.xero.com/api.xro/2.0/${path}`, { method, headers: { Authorization: `Bearer ${at}`, "Xero-tenant-id": conn.tenant_id, Accept: "application/json", "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined }); const t = await r.text(); if (!r.ok) throw new Error(`${method} ${path} ${r.status}: ${t.slice(0, 200)}`); return JSON.parse(t); };
const T = JSON.parse(readFileSync(new URL("./xero-rec-today.json", import.meta.url), "utf8")); const acct602 = T.accounts.find((a) => a.code === "602").id;
const MITCHELL = "3d786409-988c-42fb-9b23-7fc4839cc55f";
// payer (GC customer) → invoice, verified 28 Sep by name + amount + date
const links = [
  ["2026-09-23", "CU01KH7J3ZASQX", "INV-6959", 139, "NBN 100/40"], ["2026-09-23", "CU01KH7J3ZASQX", "INV-6960", 53.9, "B2B Security Monitoring"], ["2026-09-23", "CU01KH7J3ZASQX", "INV-6966", 24.75, "Duress SIM"],
  ["2026-09-23", "CU01M7ZZB29HK7C8K8W65DFN738W", "INV-6964", 249, "Snap Fitness Ramsgate (monthly)"], ["2026-09-23", "CU01M593QC183XAZECRQPCK7K6QJ", "INV-6962", 224.25, "Snap Fitness Watagan Park (monthly)"],
  ["2026-09-24", "CU01M6Q0F5B53PX4JHCNRA7Q4M7N", "INV-6974", 235.25, "Snap Fitness Huntlee (monthly)"], ["2026-09-24", "CU01M4HKGCY8VC7335HW67MXATTN", "INV-6973", 146.85, "Snap Fitness North Kellyville (yearly)"], ["2026-09-24", "CU0031CJVVBHXZ", "INV-6972", 49.5, "Snap Fitness Lutwyche Duress SIM"],
];
const { data: inv } = await sb.from("finance_xero_invoices").select("invoice_id,invoice_number,contact_id,contact_name,amount_due").in("invoice_number", links.map((l) => l[2]));
const byNo = Object.fromEntries(inv.map((i) => [i.invoice_number, i]));
const out = [];
for (const [date, gcc, no, amt, desc] of links) {
  const i = byNo[no]; if (!i || Math.abs(i.amount_due - amt) > 0.005) { console.log(`✗ ${no}: not open at $${amt}`); continue; }
  const j = await xero("PUT", "Payments", { Payments: [{ Invoice: { InvoiceID: i.invoice_id }, Account: { AccountID: acct602 }, Date: date, Amount: amt, Reference: "GoCardless payout (bank rec 28 Sep)" }] });
  const pid = j.Payments[0].PaymentID; out.push({ date, no, amt, contact: i.contact_name, payment: pid });
  console.log(`✓ ${date} ${no} ${i.contact_name} $${amt} → ${pid}`);
  await sb.from("finance_payout_items").update({ match_status: "matched_manual", xero_contact_id: i.contact_id, xero_contact_name: i.contact_name, xero_invoice_id: i.invoice_id, invoice_number: no, invoice_ids: [i.invoice_id], xero_payment_id: pid, match_note: `payer named via GoCardless mandate → ${i.contact_name}; posted by Cortex 28 Sep on Mitchell's OK`, resolved_by: MITCHELL, resolved_at: new Date().toISOString() }).eq("description", desc).eq("amount_cents", Math.round(amt * 100)).in("match_status", ["no_contact", "no_invoice", "ambiguous"]);
  const { error } = await sb.from("finance_gc_customers").update({ xero_contact_id: i.contact_id, canonical_name: i.contact_name, status: "linked", updated_at: new Date().toISOString() }).eq("gc_customer_id", gcc);
  if (error) { const r2 = await sb.from("finance_gc_customers").update({ xero_contact_id: i.contact_id, canonical_name: i.contact_name, status: "confirmed" }).eq("gc_customer_id", gcc); console.log(`   link ${gcc}: ${error.message.slice(0, 80)} → retry confirmed: ${r2.error ? r2.error.message.slice(0, 80) : "ok"}`); } else console.log(`   linked GC ${gcc} → ${i.contact_name}`);
}
// mark the three payouts posted (agent flips to reconciled once Xero says IsReconciled)
const prev = JSON.parse(readFileSync(new URL("./rec-post-2026-09-28.json", import.meta.url), "utf8")).created.filter((c) => c.kind === "payment");
for (const d of ["2026-09-23", "2026-09-24", "2026-09-25"]) { const ids = [...prev.filter((c) => c.date === d).map((c) => c.id), ...out.filter((o) => o.date === d).map((o) => o.payment)]; const { error } = await sb.from("finance_payouts").update({ status: "posted", posted: { payment_ids: ids, by: "cortex", at: new Date().toISOString(), note: "posted from the 28 Sep rec session on Mitchell's OK" }, posted_at: new Date().toISOString(), exception: null, updated_at: new Date().toISOString() }).eq("arrival_date", d).eq("provider", "gocardless"); console.log(`payout ${d}: ${error ? error.message : `posted (${ids.length} payments)`}`); }
await sb.from("finance_review_items").update({ status: "resolved", resolution: { by: "mitchell", via: "cortex 28 Sep", reason: "payer identified via GoCardless mandate and payment recorded" }, resolved_by: MITCHELL, resolved_at: new Date().toISOString() }).eq("status", "open").in("payout_id", (await sb.from("finance_payouts").select("id").in("arrival_date", ["2026-09-23", "2026-09-24", "2026-09-25"]).eq("provider", "gocardless")).data.map((p) => p.id));
writeFileSync(new URL("./rec-post-gc-2026-09-28.json", import.meta.url), JSON.stringify(out, null, 2));
await sb.from("finance_agent_actions").insert({ actor: "cortex", action: "bank_rec.gc_payers_posted", entity: "xero", entity_id: "602", after: { payments: out.length }, rule: "Mitchell OK 28 Sep", note: "8 GoCardless payer payments recorded (23/24 Sep payouts), GC customers linked to Xero contacts, payouts 23/24/25 Sep marked posted" });
console.log(`\ndone: ${out.length} payments`);
