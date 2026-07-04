// 2026-07-05 — READ-ONLY: verify the Bravofit contact renames landed in Xero
// and that existing PF invoices now display the entity name.
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

const { data: sites } = await supabase
  .from("customer_sites")
  .select("name, xero_contact_id")
  .ilike("name", "planet fitness%")
  .order("name");

console.log("Site → current Xero contact name:");
for (const s of sites ?? []) {
  if (!s.xero_contact_id) { console.log(`  ${s.name}  →  (no contact linked)`); continue; }
  const c = (await (await fetch(`https://api.xero.com/api.xro/2.0/Contacts/${s.xero_contact_id}`, { headers: XH })).json()).Contacts?.[0];
  console.log(`  ${s.name}  →  "${c?.Name ?? "??"}"`);
  await new Promise((r) => setTimeout(r, 600));
}

// Existing invoice check — INV-5754 (Thuringowa, May) + INV-5755 (Springwood).
for (const num of ["INV-5754", "INV-5755"]) {
  const w = encodeURIComponent(`InvoiceNumber=="${num}"`);
  const inv = (await (await fetch(`https://api.xero.com/api.xro/2.0/Invoices?where=${w}`, { headers: XH })).json()).Invoices?.[0];
  console.log(`\n${num} (${inv?.Status}) now bills to: "${inv?.Contact?.Name ?? "??"}"`);
}
