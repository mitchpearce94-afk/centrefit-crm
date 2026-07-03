// Site-first D3 rename batch v2 (2026-07-03, Mitchell-approved renames).
// For the 8 pairs where a dormant legacy contact already owns the site name:
//   1. rename legacy  ->  "<site> (history)"   (0 RIs, dormant — not customer-facing)
//   2. rename composite -> "<site>"            (carries the live DD RIs)
// Plus the 4 conflict-free renames. Then point customer_sites.xero_contact_id
// at the canonical (billing) contact for all 12 sites. --dry to preview.
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const DRY = process.argv.includes("--dry");
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
const XH = { Authorization: `Bearer ${tok}`, "Xero-tenant-id": conn.tenant_id, Accept: "application/json", "Content-Type": "application/json" };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function renameContact(contactId, expectCurrentName, newName) {
  // Guard: contact must still carry the expected name.
  const cur = (await (await fetch(`https://api.xero.com/api.xro/2.0/Contacts/${contactId}`, { headers: XH })).json()).Contacts?.[0];
  if (!cur) throw new Error(`contact ${contactId} not found`);
  if (cur.Name !== expectCurrentName) throw new Error(`contact ${contactId} is "${cur.Name}", expected "${expectCurrentName}"`);
  if (DRY) { console.log(`[dry] "${expectCurrentName}" → "${newName}"`); return; }
  const res = await fetch(`https://api.xero.com/api.xro/2.0/Contacts/${contactId}`, {
    method: "POST", headers: XH,
    body: JSON.stringify({ Contacts: [{ ContactID: contactId, Name: newName }] }),
  });
  if (!res.ok) throw new Error(`rename to "${newName}" failed: HTTP ${res.status} ${(await res.text()).slice(0, 150)}`);
  console.log(`OK    "${expectCurrentName}" → "${newName}"`);
  await sleep(1100);
}

// [siteName, legacyId|null, legacyName|null, canonicalId, canonicalCurrentName]
const BATCH = [
  ["Snap Fitness Armadale",     "a8e2c07a-df11-49d8-9d90-91a22ee38753", "Snap Fitness Armadale",     "82ec650c-026c-4526-af8b-843de74d5919", "Benjamin Gunning — Snap Fitness Armadale"],
  ["Snap Fitness Preston",      "9726d850-0915-4142-943f-af1ed9bf6c3f", "Snap Fitness Preston",      "bebe691c-6ee2-40ae-bc5b-bff07f441e52", "Benjamin Gunning — Snap Fitness Preston"],
  ["Snap Fitness Woodend",      "81b90306-ca46-4b53-8e67-2ad4d49f200b", "Snap Fitness Woodend",      "14a45d26-b13e-4f9d-bfb3-e77d31c602ff", "Benjamin Gunning — Snap Fitness Woodend"],
  ["Snap Fitness Marsden Park", "ed2ba372-b1c8-4c45-b852-4e5cfc4df90b", "Snap Fitness Marsden Park", "2d2323df-b730-41fa-89da-f58884a11e57", "Scott Lawrence — Snap Fitness Marsden Park"],
  ["Snap Fitness Point Cook",   "355c1982-aef1-436c-bae5-c667317b60e2", "Snap Fitness Point Cook",   "0f123d8d-34ff-496c-8876-8cacf3387fd0", "Ajit Singh — Snap Fitness Point Cook"],
  ["Snap Fitness Sunshine",     "4e8d4616-7f8a-49b8-bc93-b3aaadc5faac", "Snap Fitness Sunshine",     "85116c6c-ea27-48bb-ae97-746bb523bdb3", "Gavin Pereira — Snap Fitness Sunshine"],
  ["Snap Fitness Wantirna",     "77d30722-e01b-41da-a171-14530b67b351", "Snap Fitness Wantirna",     "f22e57b1-07cf-4808-bf53-f631e016c210", "Kosta Magdalinos — Snap Fitness Wantirna"],
  ["Core Plus Benowa",          "cf731889-0632-4515-9860-8442d9038bb2", "Core Plus Benowa",          "46980b71-cf4c-4848-9a64-7f52603464aa", "CorePlus Benowa"],
  // Conflict-free renames (no legacy contact to move aside):
  ["Snap Fitness Currimundi",   null, null, "91ee66dd-b510-4db3-9134-f53b087c2f61", "Salt Health Club"],
  ["Snap Fitness Parap",        null, null, "391c4f44-dc11-4799-bf12-7d3d89c57a7c", "Jye Thorbjornsen — Snap Fitness Parap"],
  ["Snap Fitness Southbank",    null, null, "68c543a5-8995-42c3-bb98-066980f461f2", "TBH Group"],
  ["Snap Fitness St Leonards",  null, null, "d62f04ef-5dcb-45d4-b3f2-0b6a4b745f72", "Snap Fitness St Leonards — Snap Fitness St Leonards"],
];

let ok = 0, fail = 0;
const linkable = [];
for (const [siteName, legacyId, legacyName, canonId, canonName] of BATCH) {
  try {
    if (legacyId) await renameContact(legacyId, legacyName, `${siteName} (history)`);
    await renameContact(canonId, canonName, siteName);
    linkable.push({ siteName, canonId });
    ok++;
  } catch (e) {
    console.log(`FAIL  ${siteName} — ${e.message}`);
    fail++;
  }
}

// Point CRM site records at the canonical billing contact.
for (const { siteName, canonId } of linkable) {
  if (DRY) { console.log(`[dry] link customer_sites "${siteName}" → ${canonId}`); continue; }
  const { data: rows, error } = await supabase
    .from("customer_sites")
    .update({ xero_contact_id: canonId })
    .eq("name", siteName)
    .select("id");
  if (error) console.log(`LINK FAIL ${siteName}: ${error.message}`);
  else console.log(`LINK  ${siteName} → ${canonId} (${rows?.length ?? 0} site rows)`);
}

console.log(`\n${ok} sites done, ${fail} failed${DRY ? " (dry)" : ""}.`);
