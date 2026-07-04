// 2026-07-05 — check the three leftover "Bravo Fit" dupe contacts for
// transactions; archive via API any that are empty (merge only needed when
// there's history to preserve). --dry to preview.
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

const DUPES = ["Bravo Fit Springwood Pty Ltd", "Bravo Fit Tuggeranong Pty Ltd", "Bravo Fit Mackay Pty Ltd"];
for (const name of DUPES) {
  const w = encodeURIComponent(`Name=="${name}"`);
  const c = (await xero(`Contacts?where=${w}`)).Contacts?.[0];
  if (!c) { console.log(`GONE  "${name}" — not found (already merged/archived?)`); continue; }
  const invs = (await xero(`Invoices?ContactIDs=${c.ContactID}&pageSize=100`)).Invoices ?? [];
  const ris = ((await xero("RepeatingInvoices")).RepeatingInvoices ?? [])
    .filter((r) => r.Contact?.ContactID === c.ContactID && r.Status !== "DELETED");
  const byStatus = {};
  for (const i of invs) byStatus[i.Status] = (byStatus[i.Status] ?? 0) + 1;
  console.log(`\n"${name}": ${invs.length} invoices ${JSON.stringify(byStatus)}, ${ris.length} active RIs`);
  const liveDocs = invs.filter((i) => !["DELETED", "VOIDED"].includes(i.Status)).length + ris.length;
  if (liveDocs === 0) {
    if (DRY) { console.log(`[dry] would ARCHIVE "${name}" (no live transactions)`); continue; }
    await xero(`Contacts/${c.ContactID}`, {
      method: "POST",
      body: JSON.stringify({ ContactID: c.ContactID, ContactStatus: "ARCHIVED" }),
    });
    console.log(`OK    archived "${name}"`);
  } else {
    console.log(`KEEP  "${name}" has live history — needs the Xero UI merge to preserve it`);
  }
  await sleep(1100);
}
