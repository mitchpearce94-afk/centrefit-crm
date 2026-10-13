// Read-only sweep: for every active recurring plan with a GC subscription, compare the CRM
// items total per cadence (inc GST) with the GoCardless subscription amount.
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
const env = Object.fromEntries(readFileSync(new URL("../.env.gc-probe", import.meta.url), "utf8").split("\n").filter((l) => l.includes("=")).map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, "").replace(/\\r|\\n/g, "").replace(/\r|\n/g, "").trim()]; }));
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const BASE = env.GOCARDLESS_ENVIRONMENT === "sandbox" ? "https://api-sandbox.gocardless.com" : "https://api.gocardless.com";
const gc = async (p) => { const r = await fetch(`${BASE}${p}`, { headers: { Authorization: `Bearer ${env.GOCARDLESS_API_TOKEN}`, "GoCardless-Version": "2015-07-06" } }); return r.json(); };
const { data: plans } = await sb.from("recurring_plans").select("id, status, gc_subscription_id, gc_subscription_secondary_id, customer_sites(name), customers(name), recurring_plan_items(price_inc_gst, quantity, frequency), recurring_plan_gc_subscriptions(gc_subscription_id, amount_cents, interval_unit, gc_status, source)").eq("status", "active").not("gc_subscription_id", "is", null);
let mismatches = 0, checked = 0;
for (const p of plans) {
  const totals = { monthly: 0, yearly: 0 };
  for (const it of p.recurring_plan_items || []) totals[it.frequency] = (totals[it.frequency] || 0) + Number(it.price_inc_gst) * Number(it.quantity ?? 1);
  const subs = {};
  const addon = { monthly: 0, yearly: 0 }; const addonIds = [];
  for (const l of p.recurring_plan_gc_subscriptions || []) { if (["cancelled","finished"].includes(l.gc_status)) continue; if ([p.gc_subscription_id, p.gc_subscription_secondary_id].includes(l.gc_subscription_id)) continue; addon[l.interval_unit === "yearly" ? "yearly" : "monthly"] += Number(l.amount_cents); addonIds.push(`${l.gc_subscription_id}:${l.amount_cents}:${l.gc_status}:${l.source}`); }
  for (const id of [p.gc_subscription_id, p.gc_subscription_secondary_id].filter(Boolean)) { const j = await gc(`/subscriptions/${id}`); const s = j.subscriptions; if (!s) { console.log(`${p.id.slice(0,8)} ${p.customer_sites?.name}: GC ${id} -> ${JSON.stringify(j).slice(0,100)}`); continue; } subs[s.interval_unit === "yearly" ? "yearly" : "monthly"] = { amount: s.amount, status: s.status, id }; checked++; }
  for (const cad of ["monthly", "yearly"]) {
    const want = Math.round(totals[cad] * 100) - addon[cad]; const have = subs[cad];
    if (have && have.amount !== want) { mismatches++; console.log(`MISMATCH ${p.id.slice(0,8)} | ${p.customer_sites?.name || p.customers?.name} | ${cad} CRM $${(want/100).toFixed(2)} vs GC $${(have.amount/100).toFixed(2)} (${have.status}) ${have.id}${addonIds.length ? " addons=" + addonIds.join(",") : ""}`); }
    if (!have && want > 0) console.log(`NO-SUB   ${p.id.slice(0,8)} | ${p.customer_sites?.name || p.customers?.name} | ${cad} CRM $${(want/100).toFixed(2)} but no GC subscription`);
    if (have && want === 0) console.log(`ORPHAN   ${p.id.slice(0,8)} | ${p.customer_sites?.name || p.customers?.name} | ${cad} GC $${(have.amount/100).toFixed(2)} (${have.status}) but no CRM items`);
  }
}
console.log(`\nplans ${plans.length}, subscriptions checked ${checked}, mismatches ${mismatches}`);
