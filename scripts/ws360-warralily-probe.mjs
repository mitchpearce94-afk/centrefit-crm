// 2026-09-16 — read-only: what does Xero hold against the OLD Warralily
// contact ("Snap Fitness Waralilly", b0f33b0b…) before we point the site at
// the Workspace 360 entity contact? Open invoices + repeating invoices.
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
const env = {};
for (const raw of readFileSync(new URL("../.env.gc-probe", import.meta.url), "utf8").split("\n")) {
  const line = raw.trim();
  const i = line.indexOf("=");
  if (i < 1 || line.startsWith("#")) continue;
  // the file carries literal "\n" text at the end of some values — strip it like the older scripts do
  env[line.slice(0, i).trim()] = line.slice(i + 1).trim().replace(/^"|"$/g, "").replace(/\\r|\\n/g, "").trim();
}
const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const { data: conn, error } = await supabase.from("xero_connections").select("id, tenant_id, access_token, refresh_token, expires_at").order("updated_at", { ascending: false }).limit(1).single();
if (!conn) throw new Error("no xero connection row: " + (error?.message ?? "?"));
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
const XH = { Authorization: `Bearer ${tok}`, "Xero-tenant-id": conn.tenant_id, Accept: "application/json" };
const xero = async (p) => { const r = await fetch(`https://api.xero.com/api.xro/2.0/${p}`, { headers: XH }); const j = await r.json(); if (!r.ok) throw new Error(JSON.stringify(j).slice(0, 200)); return j; };
const OLD = "b0f33b0b-372e-4630-88d7-cbbf8212ec7d";
const WS360 = "aa1bc05c-d31b-4712-b6a8-8d3e560aa561";
const inv = (await xero(`Invoices?where=${encodeURIComponent(`Contact.ContactID==Guid("${OLD}")`)}&order=Date%20DESC`)).Invoices ?? [];
console.log("invoices on old Warralily contact:", inv.length);
for (const i of inv.slice(0, 12)) console.log(` ${i.InvoiceNumber} ${i.Status} total ${i.Total} due ${i.AmountDue} date ${(i.DateString ?? "").slice(0, 10)} ref "${i.Reference ?? ""}"`);
const rep = (await xero("RepeatingInvoices")).RepeatingInvoices ?? [];
const mine = rep.filter((r) => r.Contact?.ContactID === OLD);
console.log("repeating invoices on old contact:", mine.length);
for (const r of mine) console.log(` ${r.RepeatingInvoiceID} ${r.Status} ${r.Total} every ${r.Schedule?.Period} ${r.Schedule?.Unit} next ${r.Schedule?.NextScheduledDateString} ref "${r.Reference ?? ""}"`);
console.log("repeating invoices already on Workspace 360:", rep.filter((r) => r.Contact?.ContactID === WS360).length);
