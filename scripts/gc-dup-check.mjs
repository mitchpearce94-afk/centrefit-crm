// Check CRM-managed mandates for subscriptions beyond what the plan records —
// i.e. potential double-charging. Read-only.
import { readFileSync } from "node:fs";

const data = JSON.parse(readFileSync(new URL("./gc-discovery-output.json", import.meta.url), "utf8"));

const plans = [
  { site: "Point Cook", mandate: "MD01KR0F5BQ9D84Q63Q77V01KC6P", subs: ["SB01KTAC812M7MXWHTV5X4FQAYCF"] },
  { site: "Sunshine", mandate: "MD01KR3JEQXP2BCYH4TEB455P5ZK", subs: ["SB01KT4326KGKPRSCTS88TRMEF3E", "SB01KT4326SSZCSKP41VPCN21CKN"] },
  { site: "Wantirna", mandate: "MD01KR0E7F2NK9V2Y6FTYG3M8ZQK", subs: ["SB01KT43299DEK66XV6M2BP1XV2Y"] },
  { site: "Preston", mandate: "MD01KRA8Z82JYDVHKNBQQF4BRDT4", subs: ["SB01KTAC7YD010DX0EC0T9X6JCCZ", "SB01KTAC7Y763G9P0ZZKYR5BR239"] },
  { site: "Armadale", mandate: "MD01KRA9297JVTBKK3HB42KC2GWZ", subs: ["SB01KT432BWC3M85X1KMWF9K70WA"] },
  { site: "Woodend", mandate: "MD01KSHDE8HCNWX9CX2ZWZFPRVKW", subs: ["SB01KTCYRJTSK46MZMG7NJBXABQ7"] },
  { site: "Hampton", mandate: "MD01KT36J5CP02BJZQ991YH4EWCR", subs: ["SB01KT432JRZR4T5MBH7M273MH3R"] },
  { site: "North Kellyville", mandate: "MD01KT81EEW85RJGTVFN178FF455", subs: ["SB01KT81EZ2JAWMF7338VJRQ3E0Z", "SB01KT81EZ8AWQ9QDX3ZT4S6A0H9"] },
  { site: "Charlemont Rise", mandate: "MD01KT81HTP7WRSG39YSS03FA6B8", subs: ["SB01KT81JAYMR08E7S7FDXQ199BE"] },
  { site: "Concord West", mandate: "MD01KT80G4FWGRX3EGSX9X5SXQ44", subs: ["SB01KT80GPCQAJSFFCV2MPCGRQED"] },
  { site: "Pimpama", mandate: "MD01KT86GY6637KWHAFZ6DYEKV1R", subs: ["SB01KT8YX940SQYCRHE05G0ZJDEE", "SB01KT8YX9ARY36QTP3QW13PV4KY"] },
  { site: "Ormeau", mandate: "MD01KT86DVZ2XMXS4813A9HZX90Y", subs: ["SB01KT86EA0ZMCZSTMFVQEJKBXJV", "SB01KT86EA8EV48SD9YWGF2W1H2V"] },
  { site: "Salt Health Club", mandate: "MD01KT86483DCVQSNDP7P7TPYX6Q", subs: ["SB01KT8YWVJFDCV9GV5R52TNMHVV"] },
];

for (const p of plans) {
  const onMandate = data.subscriptions.filter(
    (s) => s.links?.mandate === p.mandate && ["active", "pending_customer_approval", "paused"].includes(s.status),
  );
  const recorded = onMandate.filter((s) => p.subs.includes(s.id));
  const extra = onMandate.filter((s) => !p.subs.includes(s.id));
  const fmt = (s) => `    ${s.id} ${s.status.padEnd(8)} $${(s.amount / 100).toFixed(2).padStart(8)} ${s.interval_unit.padEnd(8)} start=${s.start_date} "${s.name}"`;
  console.log(`\n${p.site} — ${onMandate.length} live sub(s) on mandate`);
  console.log(`  recorded in CRM plan (${recorded.length}):`);
  recorded.forEach((s) => console.log(fmt(s)));
  if (extra.length) {
    console.log(`  *** EXTRA — live but NOT in plan record (${extra.length}):`);
    extra.forEach((s) => console.log(fmt(s)));
  }
}
