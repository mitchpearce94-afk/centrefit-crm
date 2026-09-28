// Marks payouts Mitchell already matched in Xero as complete in the CRM finance section, scoped to the DONE ids in finance-payout-crosscheck.json
// (every item has a same-day ACCREC payment in 602). Also resolves their open review items and audits everything. Mitchell asked 28 Sep 2026.
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
const env = Object.fromEntries(readFileSync(new URL("../.env.gc-probe", import.meta.url), "utf8").split("\n").filter((l) => l.includes("=")).map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, "").replace(/\\r|\\n/g, "").replace(/\r|\n/g, "").trim()]; }));
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const MITCHELL = "3d786409-988c-42fb-9b23-7fc4839cc55f";
const x = JSON.parse(readFileSync(new URL("./finance-payout-crosscheck.json", import.meta.url), "utf8"));
const done = x.rows.filter((r) => r.verdict.startsWith("DONE"));
const now = new Date().toISOString();
let payouts = 0, items = 0, reviews = 0;
for (const r of done) {
  const { data: before } = await sb.from("finance_payouts").select("status,exception").eq("id", r.id).single();
  if (before.status !== "reconciled") {
    const { error } = await sb.from("finance_payouts").update({ status: "reconciled", exception: null, reconciled_at: now, updated_at: now }).eq("id", r.id);
    if (error) { console.error(r.date, error.message); continue; }
    payouts++;
    await sb.from("finance_agent_actions").insert({ actor: "mitchell", action: "payout.marked_done_manual", entity: "finance_payouts", entity_id: r.id, before, after: { status: "reconciled" }, rule: "crosscheck", note: `GC payout ${r.date} net $${r.net.toFixed(2)}: every item has a same-day payment in 602 — matched by Mitchell in Xero before go-live; marked complete by Cortex on his request.` });
  }
  const { data: its } = await sb.from("finance_payout_items").select("id,match_status").eq("payout_id", r.id).eq("item_type", "payment_paid_out").in("match_status", ["no_contact", "no_invoice", "ambiguous", "unmatched", "matched"]);
  for (const it of its ?? []) {
    const { error } = await sb.from("finance_payout_items").update({ match_status: "already_paid", match_note: `verified ${now.slice(0, 10)}: same-day payment exists in 602 (Mitchell matched manually) · was ${it.match_status}`, resolved_by: MITCHELL, resolved_at: now }).eq("id", it.id);
    if (!error) items++;
  }
  const { data: rv } = await sb.from("finance_review_items").update({ status: "resolved", resolution: { by: "mitchell", via: "cortex crosscheck 2026-09-28", reason: "payout matched manually in Xero before go-live" }, resolved_by: MITCHELL, resolved_at: now }).eq("payout_id", r.id).eq("status", "open").select("id");
  reviews += rv?.length ?? 0;
}
await sb.from("finance_settings").update({ xero_day_floor: 500, updated_at: now }).eq("id", 1);
await sb.from("finance_agent_actions").insert({ actor: "cortex", action: "settings.xero_day_floor", entity: "finance_settings", entity_id: "1", before: { xero_day_floor: 300 }, after: { xero_day_floor: 500 }, note: "restored after the one-off sync; 1500 had blocked the mirror every day since 23 Sep" });
console.log(`marked complete: ${payouts} payouts, ${items} items re-stamped already_paid, ${reviews} review items resolved; floor → 500`);
const { data: p } = await sb.from("finance_payouts").select("status"); const by = {}; for (const r of p) by[r.status] = (by[r.status] || 0) + 1; console.log("payouts now:", by);
const { data: rv } = await sb.from("finance_review_items").select("status"); const br = {}; for (const r of rv) br[r.status] = (br[r.status] || 0) + 1; console.log("review items now:", br);
