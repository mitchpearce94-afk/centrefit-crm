// 2026-07-04 — Mt Druitt B2B cadence fix (Mitchell: "do the mt druitt clean up").
// Facts (probed): GC sub SB001117QJR7G2 charges $120.84 QUARTERLY (Mar/Jun/Sep/Dec ~15th) since Dec 2023.
// June quarter already paid via INV-5941 (site contact). INV-5900 (PF contact, 13-weekly child) = dupe for same period.
// Active RI a7bd2735 is MONTHLY next 2026-07-15 → would raise 3x what GC collects.
// Ops (pinned IDs, guarded):
//  1. VOID INV-5900 (PF contact, $120.84, AUTHORISED, due full amount)
//  2. CREATE quarterly RI on Snap Fitness Mt Druitt contact — clone of a7bd2735 w/ Schedule Period=3 MONTHLY, StartDate 2026-09-15
//  3. DELETE monthly RI a7bd2735
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
const xd = (ms) => { const m = /\/Date\((\d+)/.exec(ms ?? ""); return m ? new Date(Number(m[1])).toISOString().slice(0, 10) : "?"; };

async function xeroPost(path, body) {
  const res = await fetch(`https://api.xero.com/api.xro/2.0/${path}`, { method: "POST", headers: XH, body: JSON.stringify(body) });
  const text = await res.text();
  let j = null;
  try { j = text ? JSON.parse(text) : null; } catch { /* */ }
  if (!res.ok) {
    const ve = j?.Elements?.[0]?.ValidationErrors?.map((v) => v.Message).join("; ");
    throw new Error(ve ?? `HTTP ${res.status}: ${(text ?? "").slice(0, 300)}`);
  }
  return j;
}

// ---- 1. VOID INV-5900 ----
const w = encodeURIComponent(`InvoiceNumber=="INV-5900"`);
const inv = (await (await fetch(`https://api.xero.com/api.xro/2.0/Invoices?where=${w}`, { headers: XH })).json()).Invoices?.[0];
if (!inv || inv.Status !== "AUTHORISED" || Number(inv.AmountPaid) !== 0 || Number(inv.Total) !== 120.84 || !/purple fitness/i.test(inv.Contact?.Name ?? "")) {
  console.error(`ABORT void — guard failed: ${inv?.InvoiceNumber} status=${inv?.Status} total=${inv?.Total} paid=${inv?.AmountPaid} contact=${inv?.Contact?.Name}`);
} else if (DRY) {
  console.log(`[dry] would VOID INV-5900 (${inv.InvoiceID}) $120.84 on ${inv.Contact.Name}`);
} else {
  const r = await xeroPost(`Invoices/${inv.InvoiceID}`, { InvoiceID: inv.InvoiceID, Status: "VOIDED" });
  console.log(`OK    INV-5900 → ${r?.Invoices?.[0]?.Status}`);
}

// ---- 2+3. Recreate monthly RI as quarterly ----
const OLD_RI = "a7bd2735-e3f0-4cc8-86ae-65e2c4a7ca62";
const old = (await (await fetch(`https://api.xero.com/api.xro/2.0/RepeatingInvoices/${OLD_RI}`, { headers: XH })).json()).RepeatingInvoices?.[0];
if (!old || old.Status !== "AUTHORISED" || Number(old.Total) !== 120.84 || old.Schedule?.Period !== 1 || old.Schedule?.Unit !== "MONTHLY") {
  console.error(`ABORT RI swap — guard failed: status=${old?.Status} total=${old?.Total} sched=${old?.Schedule?.Period} ${old?.Schedule?.Unit}`);
  process.exit(1);
}
console.log(`old RI: ${old.Contact?.Name} $${old.Total} every ${old.Schedule.Period} ${old.Schedule.Unit} next=${xd(old.Schedule.NextScheduledDate)} approvedForSending=${old.ApprovedForSending} theme=${old.BrandingThemeID}`);

const newRi = {
  Type: "ACCREC",
  Contact: { ContactID: old.Contact.ContactID },
  Status: "AUTHORISED",
  ApprovedForSending: old.ApprovedForSending ?? false,
  BrandingThemeID: old.BrandingThemeID,
  LineAmountTypes: old.LineAmountTypes,
  Reference: old.Reference,
  LineItems: (old.LineItems ?? []).map((l) => ({
    Description: l.Description, Quantity: l.Quantity, UnitAmount: l.UnitAmount,
    AccountCode: l.AccountCode, TaxType: l.TaxType, ItemCode: l.ItemCode,
  })),
  Schedule: {
    Period: 3, Unit: "MONTHLY",
    DueDate: old.Schedule.DueDate, DueDateType: old.Schedule.DueDateType,
    StartDate: "2026-09-15",
  },
};
if (DRY) {
  console.log(`[dry] would CREATE quarterly RI (every 3 MONTHLY, start 2026-09-15) then DELETE ${OLD_RI}`);
} else {
  const created = await xeroPost("RepeatingInvoices", { RepeatingInvoices: [newRi] });
  const nid = created?.RepeatingInvoices?.[0]?.RepeatingInvoiceID;
  console.log(`OK    created quarterly RI ${nid} next=${xd(created?.RepeatingInvoices?.[0]?.Schedule?.NextScheduledDate)}`);
  if (!nid) { console.error("ABORT — create returned no ID; monthly RI left in place"); process.exit(1); }
  await xeroPost(`RepeatingInvoices/${OLD_RI}`, { RepeatingInvoiceID: OLD_RI, Status: "DELETED" });
  console.log(`OK    deleted monthly RI ${OLD_RI}`);
}
