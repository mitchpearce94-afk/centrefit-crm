// 2026-07-07 — READ-ONLY: inspect INV-5688 (Snap Penrith labour dispute) before amending.
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
const xd = (ms) => { const m = /\/Date\((\d+)/.exec(ms ?? ""); return m ? new Date(Number(m[1])).toISOString().slice(0, 10) : "?"; };

const w = encodeURIComponent(`InvoiceNumber=="INV-5688"`);
const invs = (await (await fetch(`https://api.xero.com/api.xro/2.0/Invoices?where=${w}`, { headers: XH })).json()).Invoices ?? [];
if (!invs.length) { console.log("INV-5688 not found in Xero"); process.exit(0); }
for (const stub of invs) {
  const inv = (await (await fetch(`https://api.xero.com/api.xro/2.0/Invoices/${stub.InvoiceID}`, { headers: XH })).json()).Invoices[0];
  console.log(`${inv.InvoiceNumber}  ${inv.Status}  Contact="${inv.Contact?.Name}"`);
  console.log(`Date=${xd(inv.Date)}  Due=${xd(inv.DueDate)}  Subtotal=$${inv.SubTotal}  GST=$${inv.TotalTax}  Total=$${inv.Total}  Paid=$${inv.AmountPaid}  Due=$${inv.AmountDue}`);
  console.log(`SentToContact=${inv.SentToContact}  Payments=${(inv.Payments ?? []).length}  CreditNotes=${(inv.CreditNotes ?? []).length}  LineAmountTypes=${inv.LineAmountTypes}`);
  console.log(`InvoiceID=${inv.InvoiceID}`);
  console.log("--- line items ---");
  for (const [n, li] of (inv.LineItems ?? []).entries()) {
    console.log(`${n + 1}. qty=${li.Quantity} unit=$${li.UnitAmount} line=$${li.LineAmount} tax=${li.TaxType} acct=${li.AccountCode} item=${li.ItemCode ?? "-"}`);
    console.log(`   desc: ${(li.Description ?? "").replace(/\n/g, " / ")}`);
  }
  const contact = (await (await fetch(`https://api.xero.com/api.xro/2.0/Contacts/${inv.Contact.ContactID}`, { headers: XH })).json()).Contacts?.[0];
  console.log(`--- contact email: ${contact?.EmailAddress ?? "(none)"} ---`);
}
