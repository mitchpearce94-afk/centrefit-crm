// 2026-07-04 — Mitchell-approved: enable auto-send on Heffernan NBN RI (58ba5db6…, re-dated to 20th last night).
// Xero contact email confirmed mike.heffernan@live.com; CRM emails updated to match.
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
const XH = { Authorization: `Bearer ${tok}`, "Xero-tenant-id": conn.tenant_id, Accept: "application/json", "Content-Type": "application/json" };
const xd = (ms) => { const m = /\/Date\((\d+)/.exec(ms ?? ""); return m ? new Date(Number(m[1])).toISOString().slice(0, 10) : "?"; };

const ris = ((await (await fetch("https://api.xero.com/api.xro/2.0/RepeatingInvoices", { headers: XH })).json()).RepeatingInvoices ?? [])
  .filter((r) => r.RepeatingInvoiceID.startsWith("58ba5db6") && /heffernan/i.test(r.Contact?.Name ?? "") && r.Status === "AUTHORISED");
if (ris.length !== 1) { console.error(`ABORT — expected exactly 1 matching RI, found ${ris.length}`); process.exit(1); }
const ri = ris[0];
console.log(`target: ${ri.RepeatingInvoiceID} ${ri.Contact.Name} $${ri.Total} next=${xd(ri.Schedule?.NextScheduledDate)} approvedForSending=${ri.ApprovedForSending}`);
if (ri.ApprovedForSending === true) { console.log("already enabled — nothing to do"); process.exit(0); }

// Xero can't update ApprovedForSending in place — recreate with the flag, then delete old (same as 07-03 re-dates).
async function xeroPost(path, body) {
  const res = await fetch(`https://api.xero.com/api.xro/2.0/${path}`, { method: "POST", headers: XH, body: JSON.stringify(body) });
  const text = await res.text();
  let j = null;
  try { j = text ? JSON.parse(text) : null; } catch { /* */ }
  if (!res.ok) throw new Error(j?.Elements?.[0]?.ValidationErrors?.map((v) => v.Message).join("; ") ?? `HTTP ${res.status}: ${(text ?? "").slice(0, 300)}`);
  return j;
}

const created = await xeroPost("RepeatingInvoices", { RepeatingInvoices: [{
  Type: "ACCREC",
  Contact: { ContactID: ri.Contact.ContactID },
  Status: "AUTHORISED",
  ApprovedForSending: true,
  BrandingThemeID: ri.BrandingThemeID,
  LineAmountTypes: ri.LineAmountTypes,
  Reference: ri.Reference,
  LineItems: (ri.LineItems ?? []).map((l) => ({
    Description: l.Description, Quantity: l.Quantity, UnitAmount: l.UnitAmount,
    AccountCode: l.AccountCode, TaxType: l.TaxType, ItemCode: l.ItemCode,
  })),
  Schedule: {
    Period: ri.Schedule.Period, Unit: ri.Schedule.Unit,
    DueDate: ri.Schedule.DueDate, DueDateType: ri.Schedule.DueDateType,
    StartDate: xd(ri.Schedule.NextScheduledDate),
  },
}] });
const nu = created?.RepeatingInvoices?.[0];
if (!nu?.RepeatingInvoiceID || nu.ApprovedForSending !== true) { console.error(`ABORT — create failed or flag not set: ${JSON.stringify(nu).slice(0, 200)}`); process.exit(1); }
console.log(`OK    created ${nu.RepeatingInvoiceID} approvedForSending=true next=${xd(nu.Schedule?.NextScheduledDate)}`);
await xeroPost(`RepeatingInvoices/${ri.RepeatingInvoiceID}`, { RepeatingInvoiceID: ri.RepeatingInvoiceID, Status: "DELETED" });
console.log(`OK    deleted old RI ${ri.RepeatingInvoiceID}`);

// keep CRM secondary-id in sync if any plan references the old RI
const { data: plans } = await supabase.from("recurring_plans")
  .select("id, xero_repeating_invoice_id, xero_repeating_invoice_secondary_id")
  .or(`xero_repeating_invoice_id.eq.${ri.RepeatingInvoiceID},xero_repeating_invoice_secondary_id.eq.${ri.RepeatingInvoiceID}`);
for (const p of plans ?? []) {
  const patch = {};
  if (p.xero_repeating_invoice_id === ri.RepeatingInvoiceID) patch.xero_repeating_invoice_id = nu.RepeatingInvoiceID;
  if (p.xero_repeating_invoice_secondary_id === ri.RepeatingInvoiceID) patch.xero_repeating_invoice_secondary_id = nu.RepeatingInvoiceID;
  await supabase.from("recurring_plans").update(patch).eq("id", p.id);
  console.log(`OK    CRM plan ${p.id} re-pointed to new RI`);
}
if (!plans?.length) console.log("note: no CRM plan referenced the old RI id");
