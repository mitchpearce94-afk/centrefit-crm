// 2026-07-07 — Estella backfill: 3 GC collections (6-11 $60.50, 6-19 $139, 6-19 $49.50) had no invoices.
// Templates = old split RIs (deleted, contact b7bd3b69); invoices created on CURRENT contact ce735d61.
// The 2nd $60.50 paid_out on 6-11 is a suspected double charge — NOT invoiced, refund decision is Mitchell's.
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const JOBS = [
  { date: "2026-06-11", total: 60.5, srcRi: "03fe25de", label: "B2B monitoring" },
  { date: "2026-06-19", total: 139, srcRi: "49bfd917", label: "NBN 100/40" },
  { date: "2026-06-19", total: 49.5, srcRi: "dc62a579", label: "Duress SIM" },
];
const CURRENT_CONTACT = "ce735d61"; // Snap Fitness Estella (plan 12eb8160)

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
const xd = (ms) => { const m = /\/Date\((\d+)/.exec(ms ?? ""); return m ? new Date(Number(m[1])).toISOString().slice(0, 10) : null; };
const dayDiff = (a, b) => Math.round((Date.parse(a) - Date.parse(b)) / 86400000);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const all = ((await (await fetch("https://api.xero.com/api.xro/2.0/RepeatingInvoices", { headers: XH })).json()).RepeatingInvoices ?? []);
const contact = all.find((r) => r.Contact.ContactID.startsWith(CURRENT_CONTACT))?.Contact;
if (!contact) throw new Error("current Estella contact not found");

// existing coverage on current contact
const w = encodeURIComponent('Date>=DateTime(2026,6,1)');
const existing = (await (await fetch(`https://api.xero.com/api.xro/2.0/Invoices?ContactIDs=${contact.ContactID}&Statuses=DRAFT,SUBMITTED,AUTHORISED,PAID&where=${w}&pageSize=100`, { headers: XH })).json()).Invoices ?? [];

for (const j of JOBS) {
  const src = all.find((r) => r.RepeatingInvoiceID.startsWith(j.srcRi));
  if (!src) { console.log(`FAIL ${j.label}: template RI not found`); continue; }
  if (Math.abs(src.Total - j.total) > 0.01) { console.log(`FAIL ${j.label}: template total $${src.Total} != $${j.total}`); continue; }
  const dupe = existing.find((i) => Math.abs(Number(i.Total) - j.total) < 0.01 && Math.abs(dayDiff(xd(i.Date), j.date)) <= 10);
  if (dupe) { console.log(`SKIP ${j.label}: already covered by ${dupe.InvoiceNumber}`); continue; }
  const body = {
    Invoices: [{
      Type: "ACCREC",
      Contact: { ContactID: contact.ContactID },
      Date: j.date,
      DueDate: new Date(Date.parse(j.date) + 7 * 86400000).toISOString().slice(0, 10),
      LineItems: (src.LineItems ?? []).map((l) => ({
        Description: l.Description, Quantity: l.Quantity, UnitAmount: l.UnitAmount,
        ...(l.ItemCode ? { ItemCode: l.ItemCode } : {}), AccountCode: l.AccountCode, TaxType: l.TaxType,
      })),
      LineAmountTypes: src.LineAmountTypes,
      Reference: "Plan 12eb8160",
      BrandingThemeID: src.BrandingThemeID,
      CurrencyCode: "AUD",
      Status: "AUTHORISED",
      SentToContact: true,
    }],
  };
  const res = await fetch("https://api.xero.com/api.xro/2.0/Invoices?summarizeErrors=false", { method: "POST", headers: XH, body: JSON.stringify(body) });
  const jj = await res.json();
  const inv = jj?.Invoices?.[0];
  const ve = inv?.ValidationErrors?.map((e) => e.Message).join("; ");
  if (!res.ok || ve) { console.log(`FAIL ${j.label}: ${ve ?? `HTTP ${res.status}`}`); continue; }
  if (Math.abs(Number(inv.Total) - j.total) > 0.01) { console.log(`WARN ${inv.InvoiceNumber} total $${inv.Total} != $${j.total} — REVIEW`); continue; }
  console.log(`OK   ${inv.InvoiceNumber}  ${j.date}  $${inv.Total}  Estella ${j.label}`);
  await sleep(1100);
}
