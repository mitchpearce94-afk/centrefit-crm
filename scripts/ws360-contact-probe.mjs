// 2026-09-16 — Workspace 360 asked for INV-6909 (Snap Austral) and INV-6900
// (Snap Beveridge) to be billed to "Workspace 360". Read-only probe first:
// what are the Xero contacts on those invoices called today, and what
// Workspace 360 contacts already exist (Warralily precedent).
//   node scripts/ws360-contact-probe.mjs
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
  if (!t.access_token) throw new Error("token refresh failed: " + JSON.stringify(t).slice(0, 200));
  tok = t.access_token;
  await supabase.from("xero_connections").update({ access_token: t.access_token, refresh_token: t.refresh_token ?? conn.refresh_token, expires_at: new Date(Date.now() + (t.expires_in ?? 1800) * 1000).toISOString() }).eq("id", conn.id);
}
const XH = { Authorization: `Bearer ${tok}`, "Xero-tenant-id": conn.tenant_id, Accept: "application/json", "Content-Type": "application/json" };
async function xero(path, init = {}) {
  const res = await fetch(`https://api.xero.com/api.xro/2.0/${path}`, { headers: XH, ...init });
  const text = await res.text();
  let j = null; try { j = text ? JSON.parse(text) : null; } catch { /* */ }
  if (!res.ok) throw new Error(j?.Elements?.[0]?.ValidationErrors?.map((v) => v.Message).join("; ") ?? `HTTP ${res.status}: ${text.slice(0, 200)}`);
  return j;
}
const slim = (c) => c && { id: c.ContactID, name: c.Name, email: c.EmailAddress, status: c.ContactStatus, outstanding: c.Balances?.AccountsReceivable?.Outstanding };
for (const [label, id] of [["Austral site contact", "e3533a0b-3aca-4645-8c13-e3691ad9ebd4"], ["Beveridge site contact", "60f9f816-66d4-41f7-817f-f2d38bbc415a"], ["Warralily site contact", "b0f33b0b-372e-4630-88d7-cbbf8212ec7d"]]) {
  const c = (await xero(`Contacts/${id}`)).Contacts?.[0];
  console.log(label, JSON.stringify(slim(c)));
}
const ws = (await xero(`Contacts?where=${encodeURIComponent('Name.Contains("Workspace")')}`)).Contacts ?? [];
console.log("Xero contacts containing 'Workspace':", JSON.stringify(ws.map(slim), null, 1));
for (const [num, id] of [["INV-6909", "e9de2263-8464-4957-a5e3-86f81444a888"], ["INV-6900", "33598f03-dbb2-407d-978f-8914d9c43ca7"]]) {
  const inv = (await xero(`Invoices/${id}`)).Invoices?.[0];
  console.log(num, JSON.stringify({ number: inv.InvoiceNumber, status: inv.Status, contact: inv.Contact?.Name, contactId: inv.Contact?.ContactID, total: inv.Total, paid: inv.AmountPaid, due: inv.DueDate, sent: inv.SentToContact, reference: inv.Reference }));
}
