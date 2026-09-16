// 2026-09-16 — Workspace 360 (Snap Austral + Snap Beveridge franchisee) asked
// for INV-6909 and INV-6900 to be billed to "Workspace 360". Re-point both
// AUTHORISED invoices to the existing Xero contact "Workspace 360" and carry
// the site in the Reference so their accounts team can still tell them apart.
// Then align the CRM so future invoices for those sites go to the same
// contact. --dry to preview. Nothing here emails anyone.
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
  if (!t.access_token) throw new Error("token refresh failed");
  tok = t.access_token;
  await supabase.from("xero_connections").update({ access_token: t.access_token, refresh_token: t.refresh_token ?? conn.refresh_token, expires_at: new Date(Date.now() + (t.expires_in ?? 1800) * 1000).toISOString() }).eq("id", conn.id);
}
const XH = { Authorization: `Bearer ${tok}`, "Xero-tenant-id": conn.tenant_id, Accept: "application/json", "Content-Type": "application/json" };
async function xero(path, init = {}) {
  const res = await fetch(`https://api.xero.com/api.xro/2.0/${path}`, { headers: XH, ...init });
  const text = await res.text();
  let j = null; try { j = text ? JSON.parse(text) : null; } catch { /* */ }
  if (!res.ok) throw new Error(j?.Elements?.[0]?.ValidationErrors?.map((v) => v.Message).join("; ") ?? j?.Message ?? `HTTP ${res.status}: ${text.slice(0, 300)}`);
  return j;
}

const WS360 = "aa1bc05c-d31b-4712-b6a8-8d3e560aa561"; // existing Xero contact "Workspace 360"
const JOBS = [
  { num: "INV-6909", invoiceId: "e9de2263-8464-4957-a5e3-86f81444a888", crmInvoice: "fb07dfe0-99fb-421a-a85e-8459ec5b6e81", site: "Snap Fitness Austral", siteId: "aff6f9ba-5735-446b-a3c3-9a94b4c50b31", customerId: "9292dad6-2f2c-4d8d-ac67-ac9deebabc7f", reference: "Snap Fitness Austral - CF-2026-0062 - Progress Payment 1" },
  { num: "INV-6900", invoiceId: "33598f03-dbb2-407d-978f-8914d9c43ca7", crmInvoice: "327a347a-f084-4ce4-ab17-3b07aace7dda", site: "Snap Fitness Beveridge", siteId: "d0403222-d51e-43c5-8adb-54af9cbc3c4e", customerId: "feb2e6b2-df0e-423c-b208-8c324e6affcb", reference: "Snap Fitness Beveridge - Second Payment (completion of fit off)" },
];
const ws = (await xero(`Contacts/${WS360}`)).Contacts?.[0];
if (!ws || ws.Name !== "Workspace 360") throw new Error("Workspace 360 contact not found as expected");
console.log(`target contact: ${ws.Name} (${ws.ContactID}) email ${ws.EmailAddress ?? "-"}`);

for (const j of JOBS) {
  const before = (await xero(`Invoices/${j.invoiceId}`)).Invoices?.[0];
  console.log(`${j.num}: ${before.Status}, contact "${before.Contact?.Name}", paid ${before.AmountPaid}, ref "${before.Reference}"`);
  if (before.Status !== "AUTHORISED" || Number(before.AmountPaid) > 0) { console.log(`  skip — not a clean AUTHORISED unpaid invoice`); continue; }
  if (DRY) { console.log(`  [dry] → contact Workspace 360, reference "${j.reference}"`); continue; }
  const r = await xero(`Invoices/${j.invoiceId}`, { method: "POST", body: JSON.stringify({ InvoiceID: j.invoiceId, Contact: { ContactID: WS360 }, Reference: j.reference }) });
  const after = r.Invoices?.[0];
  console.log(`  now: contact "${after.Contact?.Name}", ref "${after.Reference}", status ${after.Status}`);
  if (after.Contact?.ContactID !== WS360) throw new Error(`${j.num}: contact did not change`);
  // CRM alignment: this site + its customer bill to Workspace 360 from now on
  const s1 = await supabase.from("customer_sites").update({ invoice_name: "Workspace 360", xero_contact_id: WS360 }).eq("id", j.siteId);
  const s2 = await supabase.from("customers").update({ xero_contact_id: WS360 }).eq("id", j.customerId);
  await supabase.from("invoices").update({ xero_last_synced_at: new Date().toISOString() }).eq("id", j.crmInvoice);
  console.log(`  CRM: site ${j.site} → invoice_name "Workspace 360", contact linked ${s1.error ? "ERR " + s1.error.message : "ok"}; customer ${s2.error ? "ERR " + s2.error.message : "ok"}`);
}
console.log(DRY ? "dry run complete" : "done — nothing was emailed");
