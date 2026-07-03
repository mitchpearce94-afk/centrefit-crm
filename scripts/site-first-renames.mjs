// Mitchell-approved 2026-07-03: the 12 gym-contact renames (owner-composite
// Xero contact names → exact site names, site-first D3). Trade/personal
// contacts (Planet Homes, Hembrows, Mark Pearce) and the dirty Tuggeranong
// site name are deliberately EXCLUDED. Guards: exact current-name match,
// unique-target check (skip + report on conflict). --dry to preview.
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

const RENAMES = [
  ["Benjamin Gunning — Snap Fitness Armadale", "Snap Fitness Armadale"],
  ["Benjamin Gunning — Snap Fitness Preston", "Snap Fitness Preston"],
  ["Benjamin Gunning — Snap Fitness Woodend", "Snap Fitness Woodend"],
  ["Salt Health Club", "Snap Fitness Currimundi"],
  ["Scott Lawrence — Snap Fitness Marsden Park", "Snap Fitness Marsden Park"],
  ["Jye Thorbjornsen — Snap Fitness Parap", "Snap Fitness Parap"],
  ["Ajit Singh — Snap Fitness Point Cook", "Snap Fitness Point Cook"],
  ["TBH Group", "Snap Fitness Southbank"],
  ["Gavin Pereira — Snap Fitness Sunshine", "Snap Fitness Sunshine"],
  ["Kosta Magdalinos — Snap Fitness Wantirna", "Snap Fitness Wantirna"],
  ["CorePlus Benowa", "Core Plus Benowa"],
  ["Snap Fitness St Leonards — Snap Fitness St Leonards", "Snap Fitness St Leonards"],
];

// Load all contacts once (ACTIVE + ARCHIVED — target-name conflicts include archived).
const contacts = [];
for (let page = 1; page < 25; page++) {
  const res = await fetch(`https://api.xero.com/api.xro/2.0/Contacts?page=${page}&includeArchived=true`, { headers: XH });
  const batch = (await res.json()).Contacts ?? [];
  contacts.push(...batch);
  if (batch.length < 100) break;
  await sleep(1100);
}
const byExactName = new Map();
for (const c of contacts) {
  if (!byExactName.has(c.Name)) byExactName.set(c.Name, []);
  byExactName.get(c.Name).push(c);
}

let ok = 0, skip = 0;
for (const [from, to] of RENAMES) {
  const srcs = (byExactName.get(from) ?? []).filter((c) => c.ContactStatus === "ACTIVE");
  const conflicts = byExactName.get(to) ?? [];
  if (srcs.length !== 1) {
    console.log(`SKIP  "${from}" — ${srcs.length} active contacts with that exact name`);
    skip++;
    continue;
  }
  if (conflicts.length > 0) {
    console.log(`SKIP  "${from}" → "${to}" — target name already taken (${conflicts.map((c) => c.ContactStatus).join(",")})`);
    skip++;
    continue;
  }
  if (DRY) { console.log(`[dry] "${from}" → "${to}" (${srcs[0].ContactID})`); ok++; continue; }
  const res = await fetch(`https://api.xero.com/api.xro/2.0/Contacts/${srcs[0].ContactID}`, {
    method: "POST", headers: XH,
    body: JSON.stringify({ Contacts: [{ ContactID: srcs[0].ContactID, Name: to }] }),
  });
  if (!res.ok) {
    console.log(`FAIL  "${from}" → "${to}" — HTTP ${res.status}: ${(await res.text()).slice(0, 150)}`);
    skip++;
  } else {
    console.log(`OK    "${from}" → "${to}"`);
    ok++;
  }
  await sleep(1100);
}
console.log(`\n${ok} renamed, ${skip} skipped${DRY ? " (dry)" : ""}.`);
