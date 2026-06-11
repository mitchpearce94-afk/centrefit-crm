// Remap CRM plans' xero_repeating_invoice_id pointers to the templates that
// replaced them in the 2026-06-11 swap batches (match: same contact, same
// cadence). Also applies Currimundi's 250/100 $149 line fix to its CURRENT
// template.
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const env = Object.fromEntries(
  readFileSync(new URL("../.env.gc-probe", import.meta.url), "utf8")
    .split("\n").filter((l) => l.includes("="))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, "").replace(/\\r|\\n/g, "").trim()]; }),
);
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const { data: conn } = await sb.from("xero_connections").select("tenant_id, access_token").order("updated_at", { ascending: false }).limit(1).single();
const XH = { Authorization: `Bearer ${conn.access_token}`, "Xero-tenant-id": conn.tenant_id, Accept: "application/json", "Content-Type": "application/json" };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function xero(path, method = "GET", body) {
  for (let a = 0; a < 4; a++) {
    const res = await fetch(`https://api.xero.com/api.xro/2.0/${path}`, { method, headers: XH, body: body ? JSON.stringify(body) : undefined });
    if (res.status === 429) { await sleep((Number(res.headers.get("retry-after") ?? 6) + 1) * 1000); continue; }
    const text = await res.text();
    let j = null; try { j = text ? JSON.parse(text) : null; } catch { /* */ }
    if (!res.ok) throw new Error(`${method} ${path} → ${res.status}: ${text.slice(0, 180)}`);
    return j;
  }
  throw new Error("rate-limited");
}
const xd = (ms) => { const m = /\/Date\((\d+)/.exec(ms ?? ""); return m ? new Date(Number(m[1])).toISOString().slice(0, 10) : undefined; };

const ris = (await xero("RepeatingInvoices")).RepeatingInvoices.filter((r) => r.Status === "AUTHORISED" && r.Type === "ACCREC");
const byId = new Set(ris.map((r) => r.RepeatingInvoiceID));

const { data: plans } = await sb.from("recurring_plans")
  .select("id, xero_contact_id, xero_repeating_invoice_id, xero_repeating_invoice_secondary_id, customer_sites(name)")
  .eq("status", "active")
  .not("xero_repeating_invoice_id", "is", null);

for (const p of plans ?? []) {
  const site = (Array.isArray(p.customer_sites) ? p.customer_sites[0] : p.customer_sites)?.name ?? p.id;
  const updates = {};
  for (const [col, slot] of [["xero_repeating_invoice_id", "monthly"], ["xero_repeating_invoice_secondary_id", "yearly"]]) {
    const cur = p[col];
    if (!cur || byId.has(cur)) continue; // pointer still valid
    const candidates = ris.filter((r) => r.Contact?.ContactID === p.xero_contact_id &&
      (slot === "yearly" ? (r.Schedule.Unit === "MONTHLY" && r.Schedule.Period === 12) : (r.Schedule.Unit === "MONTHLY" && r.Schedule.Period === 1)));
    if (candidates.length === 1) {
      updates[col] = candidates[0].RepeatingInvoiceID;
      console.log(`${site}: ${slot} pointer ${cur.slice(0, 8)}… → ${candidates[0].RepeatingInvoiceID.slice(0, 8)}…`);
    } else {
      console.log(`! ${site}: ${slot} pointer dead (${cur.slice(0, 8)}…) but ${candidates.length} candidates — left for manual review`);
    }
  }
  if (Object.keys(updates).length) {
    await sb.from("recurring_plans").update({ ...updates, updated_at: new Date().toISOString() }).eq("id", p.id);
  }
}

// ── Currimundi: line → 250/100 $149 on the CURRENT template ─────────────────
const { data: cur } = await sb.from("recurring_plans").select("xero_repeating_invoice_id").eq("id", "20fff819-30c8-4c4b-ad71-e07c64772036").single();
const curRi = ris.find((r) => r.RepeatingInvoiceID === cur.xero_repeating_invoice_id);
if (!curRi) { console.log("! Currimundi current RI still unresolved"); process.exit(1); }
const body = {
  Type: "ACCREC",
  Contact: { ContactID: curRi.Contact.ContactID },
  Schedule: { Period: curRi.Schedule.Period, Unit: curRi.Schedule.Unit, DueDate: Math.max(1, curRi.Schedule.DueDate ?? 7), DueDateType: curRi.Schedule.DueDateType, StartDate: xd(curRi.Schedule.NextScheduledDate) },
  LineItems: (curRi.LineItems ?? []).map((l) => /nbn|100\/40/i.test(l.Description ?? "")
    ? { Description: "NBN Plan - 250/100", Quantity: l.Quantity, UnitAmount: 149, AccountCode: l.AccountCode, TaxType: l.TaxType }
    : { Description: l.Description, Quantity: l.Quantity, UnitAmount: l.UnitAmount, AccountCode: l.AccountCode, TaxType: l.TaxType }),
  LineAmountTypes: curRi.LineAmountTypes,
  ...(curRi.Reference ? { Reference: curRi.Reference } : {}),
  BrandingThemeID: curRi.BrandingThemeID, CurrencyCode: curRi.CurrencyCode,
  Status: "AUTHORISED", ApprovedForSending: curRi.ApprovedForSending ?? false, SendCopy: curRi.SendCopy ?? false, MarkAsSent: true, IncludePDF: true,
};
const created = (await xero("RepeatingInvoices", "POST", { RepeatingInvoices: [body] })).RepeatingInvoices[0];
await sleep(1100);
await xero(`RepeatingInvoices/${curRi.RepeatingInvoiceID}`, "POST", { RepeatingInvoiceID: curRi.RepeatingInvoiceID, Status: "DELETED" });
await sb.from("recurring_plans").update({ xero_repeating_invoice_id: created.RepeatingInvoiceID, updated_at: new Date().toISOString() }).eq("id", "20fff819-30c8-4c4b-ad71-e07c64772036");
console.log(`Currimundi: line → NBN 250/100 $149 (new RI ${created.RepeatingInvoiceID.slice(0, 8)}…), plan pointer updated`);
