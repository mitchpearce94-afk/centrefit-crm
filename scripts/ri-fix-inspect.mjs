// Read-only inspection pass before the 2026-07-03 RI fix batch:
//  - pin INV-5924's InvoiceID for the void
//  - dump NK yearly RI (0cee21b8) for recreation at 2026-09-22
//  - dump Windaroo $139 Standard-theme RI (c4a16cb3) for re-theme
//  - per-contact RI detail for Chermside / Pakenham / Mt Druitt vs GC subs
//  - locate donor RIs per service type (account codes / tax types)
//  - check Xero contacts for Glenmore Park / Raby / Mike Heffernan
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

// 1. INV-5924
const invRes = await fetch(`https://api.xero.com/api.xro/2.0/Invoices?InvoiceNumbers=INV-5924`, { headers: XH });
const inv = (await invRes.json()).Invoices?.[0];
console.log(`INV-5924: id=${inv?.InvoiceID} status=${inv?.Status} total=${inv?.Total} paid=${inv?.AmountPaid} contact=${inv?.Contact?.Name}`);

// 2. All RIs + themes
const [risRes, themesRes] = await Promise.all([
  fetch("https://api.xero.com/api.xro/2.0/RepeatingInvoices", { headers: XH }),
  fetch("https://api.xero.com/api.xro/2.0/BrandingThemes", { headers: XH }),
]);
const allRis = ((await risRes.json()).RepeatingInvoices ?? []).filter((r) => r.Type === "ACCREC");
const themeName = new Map(((await themesRes.json()).BrandingThemes ?? []).map((t) => [t.BrandingThemeID, t.Name]));

const dump = (r, prefix = "") => {
  console.log(`${prefix}${(r.Contact?.Name ?? "").padEnd(38)} | $${String(r.Total).padStart(8)} | ${r.Schedule?.Period}x${r.Schedule?.Unit} | next ${xd(r.Schedule?.NextScheduledDate)} | ${themeName.get(r.BrandingThemeID) ?? "?"} | ${r.Status} | ${r.RepeatingInvoiceID}`);
  for (const li of r.LineItems ?? []) console.log(`${prefix}    · "${li.Description?.slice(0, 60)}" qty ${li.Quantity} unit ${li.UnitAmount} acct ${li.AccountCode} tax ${li.TaxType}${li.ItemCode ? " item " + li.ItemCode : ""} (LineAmountTypes=${r.LineAmountTypes}, DueDate=${r.Schedule?.DueDate} ${r.Schedule?.DueDateType}, approvedSend=${r.ApprovedForSending}, sendCopy=${r.SendCopy})`);
};

// 3. NK yearly + Windaroo targets
console.log("\n── NK yearly RI (to recreate @ 2026-09-22):");
for (const r of allRis.filter((r) => r.RepeatingInvoiceID === "0cee21b8-f474-4ed6-a5cb-3c92cbffe784")) dump(r);
console.log("\n── Windaroo $139 (to re-theme CommsDD):");
for (const r of allRis.filter((r) => r.RepeatingInvoiceID === "c4a16cb3-0ccb-48c6-9eac-81d6af3cbca6")) dump(r);

// 4. Dupe sites — every AUTHORISED RI whose contact name mentions the site
console.log("\n── Dupe-site inspection (AUTHORISED only):");
for (const key of ["chermside", "pakenham", "druitt"]) {
  console.log(`\n[${key}]`);
  for (const r of allRis.filter((r) => r.Status === "AUTHORISED" && (r.Contact?.Name ?? "").toLowerCase().includes(key))) dump(r, "  ");
}

// 5. Donor RIs per service type (first AUTHORISED match on amount+description)
console.log("\n── Donor line-item templates:");
const donors = [
  { label: "B2B Monitoring $60.50", test: (r, li) => li.LineAmount === 60.5 && /monitor/i.test(li.Description ?? "") },
  { label: "Duress $24.75", test: (r, li) => li.LineAmount === 24.75 },
  { label: "MyAlarm $146.85", test: (r, li) => r.Total === 146.85 && /alarm/i.test(li.Description ?? "") },
  { label: "NBN $139", test: (r, li) => li.LineAmount === 139 && /nbn/i.test(li.Description ?? "") },
  { label: "Monitoring+SIM $85.25", test: (r, li) => li.LineAmount === 85.25 },
  { label: "NBN $110", test: (r, li) => li.LineAmount === 110 },
];
for (const d of donors) {
  const hit = allRis.find((r) => r.Status === "AUTHORISED" && (r.LineItems ?? []).some((li) => d.test(r, li)));
  if (hit) { console.log(`\n${d.label} ← donor:`); dump(hit, "  "); }
  else console.log(`\n${d.label} ← NO DONOR FOUND`);
}

// 6. Contacts for the three no-RI sites
console.log("\n── Contact search:");
for (const q of ["Glenmore", "Raby", "Heffernan"]) {
  const cRes = await fetch(`https://api.xero.com/api.xro/2.0/Contacts?searchTerm=${encodeURIComponent(q)}`, { headers: XH });
  const cs = (await cRes.json()).Contacts ?? [];
  console.log(`"${q}": ${cs.length ? cs.map((c) => `${c.Name} <${c.EmailAddress ?? "no-email"}> [${c.ContactStatus}] ${c.ContactID}`).join(" ;; ") : "(none)"}`);
}
