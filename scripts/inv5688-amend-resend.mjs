// 2026-07-07 — INV-5688 Snap Penrith: remove $465 stale Tradify labour (Apr 23/24 visits),
// leaving $180 (Mark 1.5hrs 2/5), strip "$465 +" from notes, resend via Xero email.
// Explicitly instructed by Mitchell 2026-07-07. Single invoice, ID asserted below.
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const INVOICE_ID = "e7655b29-b6a5-4654-98d8-f3425577f9fb";

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

// 1. Fetch fresh and assert the expected state before touching anything
const inv = (await (await fetch(`https://api.xero.com/api.xro/2.0/Invoices/${INVOICE_ID}`, { headers: XH })).json()).Invoices[0];
if (inv.InvoiceNumber !== "INV-5688") throw new Error(`Wrong invoice: ${inv.InvoiceNumber}`);
if (inv.Status !== "AUTHORISED") throw new Error(`Unexpected status ${inv.Status} — aborting`);
if (Number(inv.AmountPaid) !== 0 || (inv.Payments ?? []).length || (inv.CreditNotes ?? []).length) throw new Error("Invoice has payments/credits — aborting");
const labour = inv.LineItems.find((li) => li.Description === "Labour" && Number(li.UnitAmount) === 645);
if (!labour) throw new Error("Expected a 'Labour' line at $645 — not found, aborting");

// 2. Mutate: labour 645 -> 180; strip stray "$465 +" from the narrative line
labour.UnitAmount = 180;
labour.LineAmount = 180;
let stripped = 0;
for (const li of inv.LineItems) {
  if (li.Description?.includes("$465 +")) { li.Description = li.Description.replace(/\$465 \+\s*/g, ""); stripped++; }
}
console.log(`Labour: $645 -> $180. "$465 +" stripped from ${stripped} description line(s).`);

// 3. POST update (all lines included with LineItemIDs so nothing is dropped)
const body = JSON.stringify({ InvoiceID: INVOICE_ID, LineItems: inv.LineItems });
const upRes = await fetch(`https://api.xero.com/api.xro/2.0/Invoices/${INVOICE_ID}`, { method: "POST", headers: XH, body });
const upJson = await upRes.json();
if (!upRes.ok) throw new Error(`Update failed ${upRes.status}: ${JSON.stringify(upJson).slice(0, 500)}`);
const updated = upJson.Invoices[0];
console.log(`Updated: SubTotal=$${updated.SubTotal} GST=$${updated.TotalTax} Total=$${updated.Total} AmountDue=$${updated.AmountDue} Status=${updated.Status}`);
if (Number(updated.Total) !== 601.89) throw new Error(`Total is $${updated.Total}, expected $601.89 — NOT resending, check manually`);

// 4. Resend via Xero (goes to contact primary email)
const emRes = await fetch(`https://api.xero.com/api.xro/2.0/Invoices/${INVOICE_ID}/Email`, { method: "POST", headers: XH, body: "{}" });
console.log(emRes.status === 204 ? "Resent to contact email via Xero." : `Email send returned ${emRes.status}: ${await emRes.text()}`);
