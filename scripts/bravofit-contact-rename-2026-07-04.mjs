// 2026-07-04 — Mitchell: PF accounts team rejects invoices billed to "Planet
// Fitness ..."; invoices must show the legal entity "Bravofit <Site> Pty Ltd".
// Deliberate exception to the D3 contact-=-site-name rule (like trade accts).
// Per site: resolve THE billing contact (site_xc → cust_xc → Xero name search
// → create), rename it to the entity, write the id back to CRM site+customer.
// Also fixes Bankstown's billing email typo (bravAofit → bravofit).
// --dry to preview.
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

async function xero(path, init = {}) {
  const res = await fetch(`https://api.xero.com/api.xro/2.0/${path}`, { headers: XH, ...init });
  const text = await res.text();
  let j = null;
  try { j = text ? JSON.parse(text) : null; } catch { /* */ }
  if (!res.ok) {
    const ve = j?.Elements?.[0]?.ValidationErrors?.map((v) => v.Message).join("; ");
    throw new Error(ve ?? `HTTP ${res.status}: ${(text ?? "").slice(0, 200)}`);
  }
  return j;
}
const getContact = async (id) => (await xero(`Contacts/${id}`)).Contacts?.[0] ?? null;
const findByName = async (name) => {
  const w = encodeURIComponent(`Name=="${name.replace(/"/g, '\\"')}"`);
  return (await xero(`Contacts?where=${w}`)).Contacts?.[0] ?? null;
};

// site_id, entity name, resolved contact preference (site_xc || cust_xc), fallback search name
const SITES = [
  { siteId: "0cca046d-3200-4b2b-a131-7601a868b808", site: "Planet Fitness Armstrong Creek", entity: "Bravofit Armstrong Creek Pty Ltd", customerId: "70390e7c-88fc-449b-ae08-21d6c82d983d", xc: "65d44bd9-41fe-40f8-b058-cfac5897422e" },
  { siteId: "a70249b1-0dd9-4d9b-9e3e-58f183d35361", site: "Planet Fitness Bankstown", entity: "Bravofit Bankstown Pty Ltd", customerId: "5835c191-4203-47e9-9d4b-c62034bf2bd7", xc: "b7fefd0f-0a5b-43f1-8b26-2c07f5de36ab" },
  { siteId: "0d973ef3-9cd7-48a2-8e09-305d99f9e636", site: "Planet Fitness Epping", entity: "Bravofit Epping Pty Ltd", customerId: "863c9031-3c4d-400c-9fc5-3fefb9f56b3c", xc: null },
  { siteId: "da361ed9-7a2e-43b3-a348-4b6790fab159", site: "Planet Fitness Fountain Gate", entity: "Bravofit Fountain Gate Pty Ltd", customerId: "9ded1db6-88f6-49c5-ac71-cd4075edd0b8", xc: "f791790e-39e5-44ac-8526-a31a1e480ab5" },
  { siteId: "7a831723-ddbd-4b2e-8c2f-21a3331cb499", site: "Planet Fitness Oxley", entity: "Bravofit Oxley Pty Ltd", customerId: "ef762dab-f942-4d34-95b2-d4da1c2666e1", xc: null },
  { siteId: "53bbd785-44e6-49af-9f98-424263c6acda", site: "Planet Fitness Springwood", entity: "Bravofit Springwood Pty Ltd", customerId: "82b65887-f3a8-41be-975f-4b0be88a0711", xc: "eaa874b6-56ff-4a03-95d0-5789a0d742ef" },
  { siteId: "34a6a37c-44bd-4959-97dc-0a4b00eb643f", site: "Planet Fitness Thuringowa", entity: "Bravofit Thuringowa Pty Ltd", customerId: "cecd568d-e471-46be-878f-da6caea57f35", xc: "03082130-6d8b-46f8-88f1-fa0656b58397" },
  { siteId: "d782b05e-e631-45a4-b6ca-ea5738e7fee9", site: "Planet Fitness Tuggeranong", entity: "Bravofit Tuggeranong Pty Ltd", customerId: "5114c8eb-244d-4acf-b5df-3ed3e7cb5e28", xc: "cc994042-d297-4e49-a568-7192c160c825" },
];

for (const s of SITES) {
  try {
    // 1. Resolve the contact.
    let contact = null;
    if (s.xc) contact = await getContact(s.xc);
    if (!contact) contact = await findByName(s.site);
    if (!contact) contact = await findByName(s.entity); // already renamed manually?

    if (contact && contact.Name === s.entity) {
      console.log(`SKIP  ${s.site} — contact already named "${s.entity}"`);
    } else if (contact) {
      // Rename can collide if an entity-named contact already exists — adopt it instead.
      if (DRY) {
        console.log(`[dry] ${s.site}: rename "${contact.Name}" (${contact.ContactID.slice(0, 8)}) → "${s.entity}"`);
      } else {
        try {
          await xero(`Contacts/${contact.ContactID}`, {
            method: "POST",
            body: JSON.stringify({ ContactID: contact.ContactID, Name: s.entity }),
          });
          console.log(`OK    ${s.site}: "${contact.Name}" → "${s.entity}"`);
        } catch (err) {
          if (/already exists|must be unique/i.test(String(err))) {
            const existing = await findByName(s.entity);
            if (!existing) throw err;
            contact = existing;
            console.log(`ADOPT ${s.site}: existing "${s.entity}" contact (${existing.ContactID.slice(0, 8)})`);
          } else throw err;
        }
      }
    } else {
      // No contact anywhere — create it entity-named.
      if (DRY) {
        console.log(`[dry] ${s.site}: CREATE contact "${s.entity}"`);
      } else {
        const created = await xero("Contacts?summarizeErrors=true", {
          method: "POST",
          body: JSON.stringify({ Contacts: [{ Name: s.entity }] }),
        });
        contact = created.Contacts?.[0];
        console.log(`OK    ${s.site}: created "${s.entity}" (${contact.ContactID.slice(0, 8)})`);
      }
    }

    // 2. Point CRM site + backing customer at the canonical contact.
    if (!DRY && contact?.ContactID) {
      await supabase.from("customer_sites").update({ xero_contact_id: contact.ContactID, updated_at: new Date().toISOString() }).eq("id", s.siteId);
      await supabase.from("customers").update({ xero_contact_id: contact.ContactID, updated_at: new Date().toISOString() }).eq("id", s.customerId);
    }
    await sleep(1100);
  } catch (err) {
    console.error(`FAIL  ${s.site}: ${err instanceof Error ? err.message : err}`);
  }
}

// 3. Bankstown billing email typo: bravAofit → bravofit.
if (DRY) {
  console.log(`[dry] fix Bankstown billing_email invoices@bravaofit.com.au → invoices@bravofit.com.au`);
} else {
  const { data } = await supabase
    .from("customer_sites")
    .update({ billing_email: "invoices@bravofit.com.au", updated_at: new Date().toISOString() })
    .eq("id", "a70249b1-0dd9-4d9b-9e3e-58f183d35361")
    .eq("billing_email", "invoices@bravaofit.com.au")
    .select("billing_email");
  await supabase
    .from("customers")
    .update({ billing_email: "invoices@bravofit.com.au", updated_at: new Date().toISOString() })
    .eq("id", "5835c191-4203-47e9-9d4b-c62034bf2bd7")
    .eq("billing_email", "invoices@bravaofit.com.au");
  console.log(`OK    Bankstown billing email typo fixed${data?.length ? "" : " (site value already different — check manually)"}`);
}
console.log("\nDone.");
