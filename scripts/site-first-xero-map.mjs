// Read-only migration analysis (site-first-CONTEXT step 2+3 prep):
// map every CRM site to its current Xero contact and propose the D3 rename
// (contact display name = site name exactly). Flags shared contacts that
// serve multiple sites (can't be renamed to one site — need per-site splits).
import { readFileSync, writeFileSync } from "node:fs";
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

// All ACTIVE Xero contacts, paginated.
const xeroContacts = [];
for (let page = 1; page < 20; page++) {
  const res = await fetch(`https://api.xero.com/api.xro/2.0/Contacts?page=${page}&where=${encodeURIComponent('ContactStatus=="ACTIVE"')}`, { headers: XH });
  const batch = (await res.json()).Contacts ?? [];
  xeroContacts.push(...batch);
  if (batch.length < 100) break;
  await sleep(1100);
}
const xcById = new Map(xeroContacts.map((c) => [c.ContactID, c]));
const norm = (s) => (s ?? "").toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
const xcByName = new Map(xeroContacts.map((c) => [norm(c.Name), c]));

// All sites with backing customer.
const { data: sites } = await supabase
  .from("customer_sites")
  .select("id, name, suburb, xero_contact_id, customer:customers(id, name, is_active, xero_contact_id)")
  .order("name");

const rows = [];
const contactUse = new Map(); // ContactID -> [site names]
for (const s of sites ?? []) {
  const cust = Array.isArray(s.customer) ? s.customer[0] : s.customer;
  if (!cust || !cust.is_active) continue;
  // Resolution order: site link → customer link → exact name match on site → owner name match.
  let xc = (s.xero_contact_id && xcById.get(s.xero_contact_id))
    || (cust.xero_contact_id && xcById.get(cust.xero_contact_id))
    || xcByName.get(norm(s.name))
    || xcByName.get(norm(cust.name))
    || null;
  let via = s.xero_contact_id && xcById.get(s.xero_contact_id) ? "site-link"
    : cust.xero_contact_id && xcById.get(cust.xero_contact_id) ? "customer-link"
    : xc && norm(xc.Name) === norm(s.name) ? "name=site"
    : xc ? "name=owner" : "none";
  if (xc) {
    if (!contactUse.has(xc.ContactID)) contactUse.set(xc.ContactID, []);
    contactUse.get(xc.ContactID).push(s.name);
  }
  rows.push({ site: s.name, suburb: s.suburb, owner: cust.name, contact: xc?.Name ?? null, contactId: xc?.ContactID ?? null, via });
}

// Classify each site row.
let ok = 0;
const renames = [], creates = [], shared = [];
for (const r of rows) {
  const uses = r.contactId ? contactUse.get(r.contactId) : [];
  if (!r.contactId) { creates.push(r); continue; }
  if (uses.length > 1) { shared.push(r); continue; }
  if (norm(r.contact) === norm(r.site)) { ok++; continue; }
  renames.push(r);
}

let out = `# Site-first Xero contact map — generated 2026-07-03 (read-only)\n\n`;
out += `${rows.length} sites (active owners) · ${xeroContacts.length} active Xero contacts\n\n`;
out += `- Already named as site: ${ok}\n- RENAME needed: ${renames.length}\n- NO Xero contact found (create on first invoice): ${creates.length}\n- SHARED contact serving multiple sites (needs split): ${shared.length}\n\n`;

out += `## Renames (contact → site name) — Mitchell reviews before running\n\n| Current Xero contact | → New name (site) | Owner | via |\n|---|---|---|---|\n`;
for (const r of renames.sort((a, b) => a.site.localeCompare(b.site))) {
  out += `| ${r.contact} | ${r.site} | ${r.owner} | ${r.via} |\n`;
}

out += `\n## Shared contacts — one Xero contact, many sites (rename impossible; needs per-site contacts)\n\n`;
const sharedByContact = new Map();
for (const r of shared) {
  if (!sharedByContact.has(r.contact)) sharedByContact.set(r.contact, []);
  sharedByContact.get(r.contact).push(`${r.site} (${r.owner})`);
}
for (const [contact, list] of sharedByContact) {
  out += `- **${contact}** ← ${list.join(" · ")}\n`;
}

out += `\n## Sites with no Xero contact (contact auto-created site-named on first invoice)\n\n`;
for (const r of creates.sort((a, b) => a.site.localeCompare(b.site))) {
  out += `- ${r.site} (${r.owner})\n`;
}

writeFileSync(new URL("./site-first-xero-map.md", import.meta.url), out);
console.log(out.split("\n").slice(0, 14).join("\n"));
console.log(`\nFull report → scripts/site-first-xero-map.md`);
