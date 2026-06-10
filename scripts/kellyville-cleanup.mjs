// Kellyville consolidation (Mitchell-authorised 2026-06-11):
//  1. Cancel the 3 legacy GC subs on the DVN mandate (old pricing).
//  2. Re-date the new plan's MyAlarm yearly: cancel the Jun 16 sub, recreate
//     starting 2026-09-22 (legacy coverage runs to Sep 22).
//  3. Delete the 3 duplicate "Snap Fitness Kellyville" Xero RIs.
//  4. CRM: cancel the imported legacy plan, relink the new yearly sub.
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const env = Object.fromEntries(
  readFileSync(new URL("../.env.gc-probe", import.meta.url), "utf8")
    .split("\n").filter((l) => l.includes("="))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, "").replace(/\\r|\\n/g, "").trim()]; }),
);
const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const GC = { Authorization: `Bearer ${env.GOCARDLESS_API_TOKEN}`, "GoCardless-Version": "2015-07-06", Accept: "application/json", "Content-Type": "application/json" };

const LEGACY_SUBS = [
  { id: "SB001117W7BRDV", what: "Kellyville Duress SIM $24.75/mo" },
  { id: "SB001117VV4BMP", what: "Kellyville B2B quarterly $120.84" },
  { id: "SB001117W191VG", what: "Kellyville MyAlarm yearly $146.85" },
];
const NEW_YEARLY_OLD = "SB01KT81EZ8AWQ9QDX3ZT4S6A0H9";
const NK_MANDATE = "MD01KT81EEW85RJGTVFN178FF455";
const NK_PLAN_ID = "3954215c-b804-45b3-b024-22d7b474fe79";
const LEGACY_PLAN_ID = "ca83b107-8c35-43ec-a85f-9bee687fb62c";
const NEW_YEARLY_START = "2026-09-22";

// ── 1. cancel legacy subs ────────────────────────────────────────────────────
for (const s of LEGACY_SUBS) {
  const r = await fetch(`https://api.gocardless.com/subscriptions/${s.id}/actions/cancel`, { method: "POST", headers: GC });
  const j = await r.json();
  console.log(`legacy cancel ${s.id} (${s.what}) → ${j.subscriptions?.status ?? JSON.stringify(j).slice(0, 120)}`);
}

// ── 2. re-date the new yearly ────────────────────────────────────────────────
const c1 = await fetch(`https://api.gocardless.com/subscriptions/${NEW_YEARLY_OLD}/actions/cancel`, { method: "POST", headers: GC });
console.log(`new yearly cancel ${NEW_YEARLY_OLD} → ${(await c1.json()).subscriptions?.status}`);

const create = await fetch("https://api.gocardless.com/subscriptions", {
  method: "POST",
  headers: { ...GC, "Idempotency-Key": `nk-yearly-redate-${NEW_YEARLY_START}` },
  body: JSON.stringify({
    subscriptions: {
      amount: 14685,
      currency: "AUD",
      interval_unit: "yearly",
      start_date: NEW_YEARLY_START,
      name: "Snap Fitness North Kellyville (yearly)",
      metadata: { plan_id: NK_PLAN_ID, source: "redate-2026-06-11" },
      links: { mandate: NK_MANDATE },
    },
  }),
});
const created = await create.json();
const newSub = created.subscriptions;
if (!newSub?.id) { console.error("RECREATE FAILED:", JSON.stringify(created)); process.exit(1); }
console.log(`new yearly created ${newSub.id} start=${newSub.start_date} $${newSub.amount / 100}`);

// ── 3. delete duplicate Xero RIs ─────────────────────────────────────────────
const ris = JSON.parse(readFileSync(new URL("./xero-repeating-output.json", import.meta.url), "utf8"))
  .filter((r) => r.Contact?.Name === "Snap Fitness Kellyville" && r.Status === "AUTHORISED");
const { data: conn } = await supabase.from("xero_connections").select("id, tenant_id, access_token, refresh_token, expires_at").order("updated_at", { ascending: false }).limit(1).single();
let tok = conn.access_token;
if (!conn.expires_at || new Date(conn.expires_at).getTime() < Date.now() + 60000) {
  const res = await fetch("https://identity.xero.com/connect/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Authorization: "Basic " + Buffer.from(`${env.XERO_CLIENT_ID}:${env.XERO_CLIENT_SECRET}`).toString("base64") },
    body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: conn.refresh_token }),
  });
  const t = await res.json();
  tok = t.access_token;
  await supabase.from("xero_connections").update({ access_token: t.access_token, refresh_token: t.refresh_token ?? conn.refresh_token, expires_at: new Date(Date.now() + (t.expires_in ?? 1800) * 1000).toISOString(), updated_at: new Date().toISOString() }).eq("id", conn.id);
}
for (const r of ris) {
  const res = await fetch(`https://api.xero.com/api.xro/2.0/RepeatingInvoices/${r.RepeatingInvoiceID}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${tok}`, "Xero-tenant-id": conn.tenant_id, Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({ RepeatingInvoiceID: r.RepeatingInvoiceID, Status: "DELETED" }),
  });
  const j = await res.json();
  const st = j.RepeatingInvoices?.[0]?.Status ?? `HTTP ${res.status}: ${JSON.stringify(j).slice(0, 120)}`;
  console.log(`xero RI ${r.RepeatingInvoiceID} (${(r.LineItems?.[0]?.Description ?? "").slice(0, 40)}) → ${st}`);
}

// ── 4. CRM updates ───────────────────────────────────────────────────────────
const now = new Date().toISOString();
await supabase.from("recurring_plans").update({
  status: "cancelled",
  notes: "Legacy Kellyville billing cancelled 2026-06-11 — superseded by the North Kellyville plan (same gym; new pricing agreed). Legacy GC subs + duplicate Xero RIs cancelled.",
  updated_at: now,
}).eq("id", LEGACY_PLAN_ID);
await supabase.from("recurring_plan_gc_subscriptions").update({ gc_status: "cancelled", updated_at: now })
  .in("gc_subscription_id", LEGACY_SUBS.map((s) => s.id));
console.log("CRM: legacy plan cancelled + links marked");

await supabase.from("recurring_plans").update({
  gc_subscription_secondary_id: newSub.id,
  yearly_first_invoice_date: NEW_YEARLY_START,
  updated_at: now,
}).eq("id", NK_PLAN_ID);
await supabase.from("recurring_plan_gc_subscriptions").update({ gc_status: "cancelled", updated_at: now }).eq("gc_subscription_id", NEW_YEARLY_OLD);
await supabase.from("recurring_plan_gc_subscriptions").insert({
  plan_id: NK_PLAN_ID,
  gc_subscription_id: newSub.id,
  name: newSub.name,
  amount_cents: newSub.amount,
  currency: newSub.currency ?? "AUD",
  interval_unit: "yearly",
  interval: 1,
  start_date: newSub.start_date,
  gc_status: newSub.status,
  source: "crm",
});
console.log(`CRM: North Kellyville yearly relinked → ${newSub.id} (first charge ${NEW_YEARLY_START})`);
