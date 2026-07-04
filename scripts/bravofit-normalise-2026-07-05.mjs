// 2026-07-05 — Mitchell: every Bravofit Xero contact named "Bravofit <Site>
// Pty Ltd" + email set to invoices@bravofit.com.au. Also mirrors the billing
// email onto the CRM's 8 PF sites + backing customers (billing paths read
// customer_sites.billing_email first). --dry to preview.
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const DRY = process.argv.includes("--dry");
const TARGET_EMAIL = "invoices@bravofit.com.au";

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

// searchTerm is case-insensitive and matches name + email fields.
const seen = new Map();
for (const term of ["bravofit", "bravo fit"]) {
  const found = (await xero(`Contacts?searchTerm=${encodeURIComponent(term)}&includeArchived=true`)).Contacts ?? [];
  for (const c of found) seen.set(c.ContactID, c);
  await sleep(600);
}

const canonical = (name) => {
  let base = name
    .replace(/bravo\s*fit/i, "")
    .replace(/planet\s*fitness/i, "")
    .replace(/pty\.?\s*ltd\.?/i, "")
    .replace(/[—–-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return `Bravofit ${base} Pty Ltd`;
};

const active = [...seen.values()].filter((c) => c.ContactStatus === "ACTIVE");
const archived = [...seen.values()].filter((c) => c.ContactStatus !== "ACTIVE");
console.log(`Found ${seen.size} Bravofit-ish contacts (${active.length} active, ${archived.length} archived — archived untouched)\n`);
for (const c of archived) console.log(`  archived: "${c.Name}"`);

// Contacts already in canonical form claim their name first, so a dupe that
// normalises to the same target gets flagged for a UI merge instead of a
// rename collision. (e.g. "Bravo Fit Mackay Pty Ltd" + "Planet Fitness
// Mackay" both → "Bravofit Mackay Pty Ltd".)
active.sort((a, b) => (canonical(a.Name) === a.Name ? -1 : 0) - (canonical(b.Name) === b.Name ? -1 : 0));
const claimed = new Set(active.map((c) => canonical(c.Name) === c.Name ? c.Name : null).filter(Boolean));
for (const c of active) {
  const wantName = canonical(c.Name);
  const nameChange = wantName !== c.Name;
  const emailChange = (c.EmailAddress ?? "").toLowerCase() !== TARGET_EMAIL;
  if (!nameChange && !emailChange) { console.log(`OK    "${c.Name}" — already correct`); continue; }
  if (nameChange && claimed.has(wantName)) {
    console.log(`SKIP  "${c.Name}" → "${wantName}" already taken — merge these two in the Xero UI instead`);
    continue;
  }
  if (nameChange) claimed.add(wantName);
  if (DRY) {
    console.log(`[dry] "${c.Name}"${nameChange ? ` → "${wantName}"` : ""}${emailChange ? `  email "${c.EmailAddress ?? "(none)"}" → ${TARGET_EMAIL}` : ""}`);
    continue;
  }
  await xero(`Contacts/${c.ContactID}`, {
    method: "POST",
    body: JSON.stringify({ ContactID: c.ContactID, Name: wantName, EmailAddress: TARGET_EMAIL }),
  });
  console.log(`DONE  "${c.Name}"${nameChange ? ` → "${wantName}"` : ""}  email → ${TARGET_EMAIL}`);
  await sleep(1100);
}

// CRM mirror: PF sites + backing customers billing_email → invoices@bravofit.
if (DRY) {
  console.log(`\n[dry] would set CRM billing_email=${TARGET_EMAIL} on all 'Planet Fitness%' sites + their backing customers`);
} else {
  const { data: sites } = await supabase
    .from("customer_sites").select("id, customer_id").ilike("name", "planet fitness%");
  for (const s of sites ?? []) {
    await supabase.from("customer_sites").update({ billing_email: TARGET_EMAIL, updated_at: new Date().toISOString() }).eq("id", s.id);
    await supabase.from("customers").update({ billing_email: TARGET_EMAIL, updated_at: new Date().toISOString() }).eq("id", s.customer_id);
  }
  console.log(`\nDONE  CRM billing_email mirrored on ${(sites ?? []).length} PF sites + owners`);
}
