// 2026-07-04 — READ-ONLY probe: Mt Druitt / Pakenham cadence question.
// GC sub config says interval=3 (quarterly). Verify against actual GC payments,
// and list current Xero RIs for the Mt Druitt contacts (did last night's kept
// monthly RI leave us about to over-invoice from 15 July?).
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const env = Object.fromEntries(
  readFileSync(new URL("../.env.gc-probe", import.meta.url), "utf8")
    .split("\n").filter((l) => l.includes("="))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, "").replace(/\\r|\\n/g, "").trim()]; }),
);

const GH = { Authorization: `Bearer ${env.GOCARDLESS_API_TOKEN}`, "GoCardless-Version": "2015-07-06" };
const GC = env.GOCARDLESS_ENVIRONMENT === "sandbox" ? "https://api-sandbox.gocardless.com" : "https://api.gocardless.com";

for (const [label, sub] of [["Mt Druitt B2B", "SB001117QJR7G2"], ["Pakenham Security & SIM", "SB001117PEA5H9"]]) {
  const s = (await (await fetch(`${GC}/subscriptions/${sub}`, { headers: GH })).json()).subscriptions;
  console.log(`\n=== ${label} (${sub}) — GC config: ${s.amount / 100} ${s.currency} every ${s.interval} ${s.interval_unit}, day ${s.day_of_month}, status ${s.status}`);
  const pays = (await (await fetch(`${GC}/payments?subscription=${sub}&limit=10`, { headers: GH })).json()).payments ?? [];
  for (const p of pays) console.log(`  ${p.charge_date}  $${(p.amount / 100).toFixed(2)}  ${p.status}`);
}

// Xero RIs for Mt Druitt contacts
const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
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
const XH = { Authorization: `Bearer ${tok}`, "Xero-tenant-id": conn.tenant_id, Accept: "application/json" };
const xd = (ms) => { const m = /\/Date\((\d+)/.exec(ms ?? ""); return m ? new Date(Number(m[1])).toISOString().slice(0, 10) : "?"; };

const ris = ((await (await fetch("https://api.xero.com/api.xro/2.0/RepeatingInvoices", { headers: XH })).json()).RepeatingInvoices ?? [])
  .filter((r) => r.Type === "ACCREC" && /druitt|purple fitness|pakenham|just focus/i.test(r.Contact?.Name ?? ""));
console.log("\n=== Xero RIs (Mt Druitt / Purple Fitness / Pakenham / Just Focus contacts):");
for (const r of ris) {
  const li = (r.LineItems ?? []).map((l) => l.Description?.slice(0, 50)).join(" | ");
  console.log(`  ${r.RepeatingInvoiceID}  ${r.Contact?.Name}  $${r.Total}  every ${r.Schedule?.Period} ${r.Schedule?.Unit}  next=${xd(r.Schedule?.NextScheduledDate)}  status=${r.Status}\n    lines: ${li}`);
}
