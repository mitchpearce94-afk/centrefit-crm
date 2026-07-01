// Total recurring revenue: DD plans (CRM) + authorised Xero RIs that aren't
// the invoice for a DD plan (no double count) + the unbilled backlog.
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const env = Object.fromEntries(
  readFileSync(new URL("../.env.gc-probe", import.meta.url), "utf8")
    .split("\n").filter((l) => l.includes("="))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, "").replace(/\\r|\\n/g, "").trim()]; }),
);
const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const BRANDS = /\b(snap fitness|snap|sf|9 ?rounds?|core ?plus|coreplus|just focus|fit4eva|planet fitness|total fusion|fitness)\b/g;
const NOISE = /\b(pty|ltd|atf|t\/?a|trust|group|the|family|nominees|security|myalarm|duress intercom|duress|b2b|monitoring|intercom|homes|24\/?7|247)\b/g;
const norm = (s) => (s ?? "").toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
const siteTokens = (s) => norm(s).replace(BRANDS, " ").replace(NOISE, " ").replace(/\s+/g, " ").trim().split(" ").filter((w) => w.length >= 3 && !/^\d+$/.test(w));
const nameMatches = (a, b) => { const bn = " " + norm(b) + " "; const t = siteTokens(a); return t.length > 0 && t.every((x) => bn.includes(x)); };

const { data: plans } = await supabase
  .from("recurring_plans")
  .select("status, customers(name), customer_sites(name), recurring_plan_items(service_code, service_name, price_inc_gst, frequency, quantity)")
  .eq("status", "active");

const factor = (f) => (f === "yearly" ? 1 / 12 : f === "quarterly" ? 1 / 3 : 1);
const stream = (t) => /nbn/i.test(t) ? "nbn" : /my ?alarm|ifob/i.test(t) ? "myalarm" : /sim/i.test(t) ? "sim" : /monitor|b2b|duress|alarm|security/i.test(t) ? "security" : /voip/i.test(t) ? "voip" : "other";

const streams = { nbn: 0, security: 0, sim: 0, myalarm: 0, voip: 0, other: 0 };
let ddTotal = 0;
const planNames = [];
for (const p of plans) {
  const c = (Array.isArray(p.customers) ? p.customers[0] : p.customers)?.name ?? "";
  const s = (Array.isArray(p.customer_sites) ? p.customer_sites[0] : p.customer_sites)?.name ?? "";
  planNames.push({ c, s });
  for (const i of p.recurring_plan_items ?? []) {
    const m = Number(i.price_inc_gst) * (i.quantity ?? 1) * factor(i.frequency);
    ddTotal += m;
    streams[stream(`${i.service_code} ${i.service_name}`)] += m;
  }
}

const ris = JSON.parse(readFileSync(new URL("./xero-repeating-output.json", import.meta.url), "utf8"))
  .filter((r) => r.Status === "AUTHORISED");

function riMonthly(r) {
  const unit = r.Schedule?.Unit, period = r.Schedule?.Period ?? 1, total = r.Total ?? 0;
  if (unit === "MONTHLY") return total / period;
  if (unit === "WEEKLY") return total / period * (52 / 12);
  return total;
}

let xeroOnly = 0, xeroDup = 0;
const xeroStreams = { nbn: 0, security: 0, sim: 0, myalarm: 0, voip: 0, other: 0 };
const xeroOnlyList = [];
for (const r of ris) {
  const contact = r.Contact?.Name ?? "";
  const matched = planNames.some(({ c, s }) =>
    nameMatches(contact, s) || nameMatches(contact, c) || nameMatches(s, contact) || (c && nameMatches(c, contact)));
  const m = riMonthly(r);
  if (matched) { xeroDup += m; continue; }
  xeroOnly += m;
  xeroOnlyList.push({ contact, m });
  const lines = (r.LineItems ?? []).map((l) => l.Description ?? "").join(" ");
  // crude per-RI stream split: assign whole RI to its dominant keyword
  xeroStreams[stream(lines)] += m;
}

const UNBILLED = 4151.64; // recon 2026-06-11

console.log("=== Monthly recurring revenue (incl. GST) ===\n");
console.log(`DD plans (54 active, CRM):        $${ddTotal.toFixed(2)}`);
console.log(`Xero RIs only (no DD):            $${xeroOnly.toFixed(2)}   (${xeroOnlyList.length} templates)`);
console.log(`Unbilled — to be fixed:           $${UNBILLED.toFixed(2)}`);
console.log(`----------------------------------------------`);
console.log(`TOTAL                             $${(ddTotal + xeroOnly + UNBILLED).toFixed(2)}/mo`);
console.log(`                                  $${((ddTotal + xeroOnly + UNBILLED) * 12).toFixed(0)}/yr`);
console.log(`\n(Xero RIs matching a DD plan — same money, not double-counted: $${xeroDup.toFixed(2)}/mo)`);
console.log("\nStream split (DD plans):", Object.entries(streams).map(([k, v]) => `${k} $${v.toFixed(0)}`).join("  "));
console.log("Stream split (Xero-only):", Object.entries(xeroStreams).map(([k, v]) => `${k} $${v.toFixed(0)}`).join("  "));
console.log("\nTop 15 Xero-only contacts by $/mo:");
for (const x of xeroOnlyList.sort((a, b) => b.m - a.m).slice(0, 15)) console.log(`  $${x.m.toFixed(2).padStart(8)}  ${x.contact}`);
