// Read-only: inspect the 8 rename-conflict pairs (composite contact vs
// existing site-named contact). For each contact: ACCREC invoice count,
// latest invoice date, authorised RI count. Decides the resolution per the
// empty-duplicate rule; prints, does not act.
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const env = Object.fromEntries(
  readFileSync(new URL("../.env.gc-probe", import.meta.url), "utf8")
    .split("\n").filter((l) => l.includes("="))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, "").replace(/\\r|\\n/g, "").trim()]; }),
);
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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const xd = (ms) => { const m = /\/Date\((\d+)/.exec(ms ?? ""); return m ? new Date(Number(m[1])).toISOString().slice(0, 10) : "?"; };

const PAIRS = [
  ["Benjamin Gunning — Snap Fitness Armadale", "Snap Fitness Armadale"],
  ["Benjamin Gunning — Snap Fitness Preston", "Snap Fitness Preston"],
  ["Benjamin Gunning — Snap Fitness Woodend", "Snap Fitness Woodend"],
  ["Scott Lawrence — Snap Fitness Marsden Park", "Snap Fitness Marsden Park"],
  ["Ajit Singh — Snap Fitness Point Cook", "Snap Fitness Point Cook"],
  ["Gavin Pereira — Snap Fitness Sunshine", "Snap Fitness Sunshine"],
  ["Kosta Magdalinos — Snap Fitness Wantirna", "Snap Fitness Wantirna"],
  ["CorePlus Benowa", "Core Plus Benowa"],
];

// Contacts by exact name (active only).
const contacts = [];
for (let page = 1; page < 20; page++) {
  const res = await fetch(`https://api.xero.com/api.xro/2.0/Contacts?page=${page}&where=${encodeURIComponent('ContactStatus=="ACTIVE"')}`, { headers: XH });
  const batch = (await res.json()).Contacts ?? [];
  contacts.push(...batch);
  if (batch.length < 100) break;
  await sleep(1100);
}
const byName = new Map(contacts.map((c) => [c.Name, c]));

// All authorised RIs, counted per contact.
const risRes = await fetch("https://api.xero.com/api.xro/2.0/RepeatingInvoices", { headers: XH });
const riCount = new Map();
for (const r of ((await risRes.json()).RepeatingInvoices ?? []).filter((r) => r.Status === "AUTHORISED" && r.Type === "ACCREC")) {
  const id = r.Contact?.ContactID;
  riCount.set(id, (riCount.get(id) ?? 0) + 1);
}

async function invoiceSummary(contactId) {
  const res = await fetch(`https://api.xero.com/api.xro/2.0/Invoices?ContactIDs=${contactId}&where=${encodeURIComponent('Type=="ACCREC"')}&order=Date DESC&page=1`, { headers: XH });
  const invs = (await res.json()).Invoices ?? [];
  await sleep(1100);
  return { count: invs.length === 100 ? "100+" : invs.length, latest: invs[0] ? xd(invs[0].Date) : "-" };
}

for (const [compositeName, siteName] of PAIRS) {
  const a = byName.get(compositeName), b = byName.get(siteName);
  console.log(`\n═ ${siteName}`);
  for (const [label, c] of [["composite", a], ["site-named", b]]) {
    if (!c) { console.log(`  ${label.padEnd(10)} MISSING`); continue; }
    const inv = await invoiceSummary(c.ContactID);
    console.log(`  ${label.padEnd(10)} "${c.Name}" | invoices ${inv.count} (latest ${inv.latest}) | RIs ${riCount.get(c.ContactID) ?? 0} | ${c.ContactID}`);
  }
}
