// 2026-07-07 — INV-5688 step 2: labour already $180 but stale TaxAmount kept GST at $101.22.
// Clear TaxAmounts so Xero recalculates (expect $54.72 GST / $601.89 total), then resend.
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

const inv = (await (await fetch(`https://api.xero.com/api.xro/2.0/Invoices/${INVOICE_ID}`, { headers: XH })).json()).Invoices[0];
if (inv.InvoiceNumber !== "INV-5688" || inv.Status !== "AUTHORISED") throw new Error(`Unexpected ${inv.InvoiceNumber}/${inv.Status}`);
const labour = inv.LineItems.find((li) => li.Description?.startsWith("Labour"));
if (!labour || Number(labour.UnitAmount) !== 180) throw new Error(`Labour line unexpected: $${labour?.UnitAmount}`);
for (const li of inv.LineItems) delete li.TaxAmount;

const upRes = await fetch(`https://api.xero.com/api.xro/2.0/Invoices/${INVOICE_ID}`, { method: "POST", headers: XH, body: JSON.stringify({ InvoiceID: INVOICE_ID, LineItems: inv.LineItems }) });
const upJson = await upRes.json();
if (!upRes.ok) throw new Error(`Update failed ${upRes.status}: ${JSON.stringify(upJson).slice(0, 500)}`);
const updated = upJson.Invoices[0];
console.log(`SubTotal=$${updated.SubTotal} GST=$${updated.TotalTax} Total=$${updated.Total} Status=${updated.Status}`);
if (Number(updated.Total) !== 601.89) throw new Error(`Total is $${updated.Total}, expected $601.89 — NOT resending`);

const emRes = await fetch(`https://api.xero.com/api.xro/2.0/Invoices/${INVOICE_ID}/Email`, { method: "POST", headers: XH, body: "{}" });
console.log(emRes.status === 204 ? "Resent to contact email via Xero." : `Email send returned ${emRes.status}: ${await emRes.text()}`);
