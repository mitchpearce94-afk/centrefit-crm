// Analyse gc-discovery-output.json: join subscriptions -> mandates -> customers,
// flag what the CRM already tracks, summarise the rest. Read-only.
import { readFileSync } from "node:fs";

const data = JSON.parse(readFileSync(new URL("./gc-discovery-output.json", import.meta.url), "utf8"));

// CRM-known GC ids (from recurring_plans, 2026-06-10)
const crmSubs = new Set([
  "SB01KTAC812M7MXWHTV5X4FQAYCF","SB01KT4326KGKPRSCTS88TRMEF3E","SB01KT4326SSZCSKP41VPCN21CKN",
  "SB01KT43299DEK66XV6M2BP1XV2Y","SB01KTAC7YD010DX0EC0T9X6JCCZ","SB01KTAC7Y763G9P0ZZKYR5BR239",
  "SB01KT432BWC3M85X1KMWF9K70WA","SB01KTCYRJTSK46MZMG7NJBXABQ7","SB01KT432JRZR4T5MBH7M273MH3R",
  "SB01KT81EZ2JAWMF7338VJRQ3E0Z","SB01KT81EZ8AWQ9QDX3ZT4S6A0H9","SB01KT81JAYMR08E7S7FDXQ199BE",
  "SB01KT80GPCQAJSFFCV2MPCGRQED","SB01KT8YX940SQYCRHE05G0ZJDEE","SB01KT8YX9ARY36QTP3QW13PV4KY",
  "SB01KT86EA0ZMCZSTMFVQEJKBXJV","SB01KT86EA8EV48SD9YWGF2W1H2V","SB01KT8YWVJFDCV9GV5R52TNMHVV",
]);
const crmMandates = new Set([
  "MD01KR0F5BQ9D84Q63Q77V01KC6P","MD01KR3JEQXP2BCYH4TEB455P5ZK","MD01KR0E7F2NK9V2Y6FTYG3M8ZQK",
  "MD01KRA8Z82JYDVHKNBQQF4BRDT4","MD01KRA9297JVTBKK3HB42KC2GWZ","MD01KSHDE8HCNWX9CX2ZWZFPRVKW",
  "MD01KT36J5CP02BJZQ991YH4EWCR","MD01KT81EEW85RJGTVFN178FF455","MD01KT81HTP7WRSG39YSS03FA6B8",
  "MD01KT80G4FWGRX3EGSX9X5SXQ44","MD01KT86GY6637KWHAFZ6DYEKV1R","MD01KT86DVZ2XMXS4813A9HZX90Y",
  "MD01KT86483DCVQSNDP7P7TPYX6Q",
]);

const mandateById = new Map(data.mandates.map((m) => [m.id, m]));
const customerById = new Map(data.customers.map((c) => [c.id, c]));

const subsByStatus = {};
for (const s of data.subscriptions) subsByStatus[s.status] = (subsByStatus[s.status] ?? 0) + 1;
console.log("Subscription status breakdown:", JSON.stringify(subsByStatus));

const mandatesByStatus = {};
for (const m of data.mandates) mandatesByStatus[m.status] = (mandatesByStatus[m.status] ?? 0) + 1;
console.log("Mandate status breakdown:", JSON.stringify(mandatesByStatus));

const active = data.subscriptions.filter((s) => s.status === "active");
const legacy = active.filter((s) => !crmSubs.has(s.id));
console.log(`\nActive subs: ${active.length} | CRM-tracked: ${active.length - legacy.length} | LEGACY (not in CRM): ${legacy.length}\n`);

const rows = legacy.map((s) => {
  const m = mandateById.get(s.links?.mandate);
  const c = m ? customerById.get(m.links?.customer) : null;
  return {
    customer: c ? (c.company_name || `${c.given_name ?? ""} ${c.family_name ?? ""}`.trim()) : "?",
    email: c?.email ?? "?",
    subId: s.id,
    name: s.name ?? "",
    amount: (s.amount / 100).toFixed(2),
    interval: `${s.interval ?? 1}x${s.interval_unit}`,
    dayOfMonth: s.day_of_month ?? "",
    mandate: m?.id ?? "?",
    mandateStatus: m?.status ?? "?",
    legacyMandate: m ? !crmMandates.has(m.id) : true,
  };
});

rows.sort((a, b) => a.customer.localeCompare(b.customer) || a.name.localeCompare(b.name));
let mrr = 0;
for (const r of rows) {
  const monthly = r.interval.endsWith("monthly") ? Number(r.amount) : r.interval.endsWith("yearly") ? Number(r.amount) / 12 : Number(r.amount) * 4.33;
  mrr += monthly;
  console.log(`${r.customer.padEnd(38)} ${r.email.padEnd(42)} $${r.amount.padStart(9)} ${r.interval.padEnd(10)} ${r.name.slice(0, 40).padEnd(40)} ${r.subId} ${r.mandate} (${r.mandateStatus}${r.legacyMandate ? ", legacy-mandate" : ", CRM-mandate"})`);
}
console.log(`\nLegacy active MRR equivalent: $${mrr.toFixed(2)}/month across ${rows.length} subscriptions, ${new Set(rows.map((r) => r.email)).size} distinct customer emails`);
