// 2026-07-03 RI fix batch — Mitchell-authorised ("1,2,3,4,6 do all of those").
// Actions (every destructive op pinned to an explicit ID, guarded, --dry first):
//  V1. VOID INV-5924 (a6d936f5) — NK MyAlarm yearly, double-bills paid-up period
//  R1. NK yearly RI 0cee21b8 → recreate @ 2026-09-22 (align w/ GC yearly sub), delete old, update CRM secondary id
//  R2. Windaroo NBN RI c4a16cb3 → recreate on Communications DD (date kept 2026-07-29), delete old
//  R3. Heffernan NBN RI 646e1aca → recreate @ 2026-07-20 (align w/ GC day 20), delete old
//  R4. Mt Druitt B2B RI b31bc887 → recreate @ 2026-07-15 (align w/ GC day 15), delete old
//  D1. DELETE Mt Druitt duress RI f2301e59 (dupe — PF-contact duress @15th is the aligned one)
//  D2. DELETE Purple Fitness 13xWEEKLY $120.84 B2B RI (cadence doesn't match GC monthly; resolved at runtime, strict match)
//  C1-3. CREATE Glenmore Park contact + 3 RIs (B2B $60.50 + Duress $24.75 @ 2026-07-05; MyAlarm $146.85 @ 2027-05-26)
//  C4-6. CREATE Raby 3 RIs on existing contact b7999068 (GF-NBN $139 @ 07-13; SIM/B2B $85.25 @ 07-12; MyAlarm $146.85 @ 2026-11-24)
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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const xd = (ms) => { const m = /\/Date\((\d+)/.exec(ms ?? ""); return m ? new Date(Number(m[1])).toISOString().slice(0, 10) : "?"; };

async function xeroPost(path, body) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch(`https://api.xero.com/api.xro/2.0/${path}`, { method: "POST", headers: XH, body: JSON.stringify(body) });
    if (res.status === 429) { await sleep((Number(res.headers.get("retry-after") ?? 5) + 1) * 1000); continue; }
    const text = await res.text();
    let j = null;
    try { j = text ? JSON.parse(text) : null; } catch { /* */ }
    if (!res.ok) {
      const ve = j?.Elements?.[0]?.ValidationErrors?.map((v) => v.Message).join("; ");
      throw new Error(ve ?? `HTTP ${res.status}: ${(text ?? "").slice(0, 300)}`);
    }
    return j;
  }
  throw new Error("rate-limited after retries");
}

const THEME_SOLUTIONS_DD = "00b4c929-b051-4fbe-ac6e-6ef515fd8790";
const THEME_COMMS_DD = "8df39a01-d87b-46a3-85cb-38225ea667f1";

const risJson = await (await fetch("https://api.xero.com/api.xro/2.0/RepeatingInvoices", { headers: XH })).json();
const allRis = (risJson.RepeatingInvoices ?? []).filter((r) => r.Type === "ACCREC");
const byId = new Map(allRis.map((r) => [r.RepeatingInvoiceID, r]));

const results = [];
const act = async (label, fn) => {
  try {
    if (DRY) { console.log(`[dry] ${label}`); results.push({ label, ok: true, dry: true }); return; }
    const out = await fn();
    console.log(`OK    ${label}${out ? ` — ${out}` : ""}`);
    results.push({ label, ok: true });
    await sleep(1100);
  } catch (e) {
    console.log(`FAIL  ${label} — ${e.message}`);
    results.push({ label, ok: false, err: e.message });
  }
};

// Recreate helper: copy `src`, override schedule start / theme, create → delete old.
async function recreate(src, { startDate, brandingThemeID, label }) {
  const body = {
    Type: "ACCREC",
    Contact: { ContactID: src.Contact.ContactID },
    Schedule: {
      Period: src.Schedule.Period,
      Unit: src.Schedule.Unit,
      DueDate: src.Schedule.DueDateType === "DAYSAFTERBILLDATE" ? Math.max(1, src.Schedule.DueDate ?? 1) : src.Schedule.DueDate,
      DueDateType: src.Schedule.DueDateType,
      StartDate: startDate,
    },
    LineItems: (src.LineItems ?? []).map((l) => ({
      Description: l.Description,
      Quantity: l.Quantity,
      UnitAmount: l.UnitAmount,
      ...(l.ItemCode ? { ItemCode: l.ItemCode } : {}),
      AccountCode: l.AccountCode,
      TaxType: l.TaxType,
    })),
    LineAmountTypes: src.LineAmountTypes,
    ...(src.Reference ? { Reference: src.Reference } : {}),
    BrandingThemeID: brandingThemeID ?? src.BrandingThemeID,
    CurrencyCode: src.CurrencyCode,
    Status: "AUTHORISED",
    ApprovedForSending: src.ApprovedForSending ?? false,
    SendCopy: src.SendCopy ?? false,
    MarkAsSent: true,
    IncludePDF: true,
  };
  const created = await xeroPost("RepeatingInvoices", { RepeatingInvoices: [body] });
  const newId = created?.RepeatingInvoices?.[0]?.RepeatingInvoiceID;
  if (!newId) throw new Error("create returned no id");
  await sleep(1100);
  await xeroPost(`RepeatingInvoices/${src.RepeatingInvoiceID}`, { RepeatingInvoiceID: src.RepeatingInvoiceID, Status: "DELETED" });
  return newId;
}

// Guard: source RI must exist, be AUTHORISED, and match the expected total.
function pin(id, expectTotal, what) {
  const r = byId.get(id);
  if (!r) throw new Error(`${what}: RI ${id} not found — aborting this item`);
  if (r.Status !== "AUTHORISED") throw new Error(`${what}: RI ${id} status ${r.Status}, expected AUTHORISED`);
  if (Math.abs(r.Total - expectTotal) > 0.01) throw new Error(`${what}: RI ${id} total ${r.Total}, expected ${expectTotal}`);
  return r;
}

console.log(`${DRY ? "═══ DRY RUN ═══" : "═══ LIVE RUN ═══"}\n`);

// ── V1. Void INV-5924 ──
await act("V1 void INV-5924 (a6d936f5, $146.85, NK MyAlarm)", async () => {
  const inv = (await (await fetch("https://api.xero.com/api.xro/2.0/Invoices/a6d936f5-0cf3-4bf9-b5d9-7074a7b26497", { headers: XH })).json()).Invoices?.[0];
  if (!inv) throw new Error("invoice not found");
  if (inv.Status !== "AUTHORISED" || Number(inv.AmountPaid) !== 0) throw new Error(`status ${inv.Status}, paid ${inv.AmountPaid} — not safe to void`);
  await xeroPost("Invoices", { Invoices: [{ InvoiceID: "a6d936f5-0cf3-4bf9-b5d9-7074a7b26497", Status: "VOIDED" }] });
});

// ── R1. NK yearly re-date → 2026-09-22 ──
let nkNewId = null;
await act("R1 NK yearly 0cee21b8 → recreate @ 2026-09-22, delete old", async () => {
  const src = pin("0cee21b8-f474-4ed6-a5cb-3c92cbffe784", 146.85, "NK yearly");
  nkNewId = await recreate(src, { startDate: "2026-09-22", label: "NK yearly" });
  return `new ${nkNewId}`;
});
if (nkNewId && !DRY) {
  await act("R1b CRM: update NK plan secondary RI id", async () => {
    const { error } = await supabase.from("recurring_plans")
      .update({ xero_repeating_invoice_secondary_id: nkNewId })
      .eq("id", "3954215c-b804-45b3-b024-22d7b474fe79");
    if (error) throw new Error(error.message);
  });
}

// ── R2. Windaroo re-theme → Comms DD (date kept) ──
await act("R2 Windaroo c4a16cb3 → CommsDD, date kept 2026-07-29, delete old", async () => {
  const src = pin("c4a16cb3-0ccb-48c6-9eac-81d6af3cbca6", 139, "Windaroo NBN");
  const keep = xd(src.Schedule?.NextScheduledDate);
  if (keep !== "2026-07-29") throw new Error(`next date moved to ${keep}, expected 2026-07-29 — re-inspect`);
  const newId = await recreate(src, { startDate: keep, brandingThemeID: THEME_COMMS_DD });
  return `new ${newId}`;
});

// ── R3. Heffernan align day 13 → 20 ──
await act("R3 Heffernan 646e1aca → recreate @ 2026-07-20, delete old", async () => {
  const src = pin("646e1aca-bd89-46e4-b0ca-a9b58960278d", 110, "Heffernan NBN");
  const newId = await recreate(src, { startDate: "2026-07-20" });
  return `new ${newId}`;
});

// ── R4. Mt Druitt B2B align day 10 → 15 ──
await act("R4 MtDruitt B2B b31bc887 → recreate @ 2026-07-15, delete old", async () => {
  const src = pin("b31bc887-dd75-4c66-a245-6ef7545bd0a7", 120.84, "MtDruitt B2B");
  const newId = await recreate(src, { startDate: "2026-07-15" });
  return `new ${newId}`;
});

// ── D1. Delete Mt Druitt duress dupe (misaligned @10th; PF duress @15th stays) ──
await act("D1 DELETE MtDruitt duress f2301e59 ($24.75 @10th — dupe of PF duress @15th)", async () => {
  pin("f2301e59-0fb3-45cd-bb20-42d71b26b1b4", 24.75, "MtDruitt duress");
  await xeroPost("RepeatingInvoices/f2301e59-0fb3-45cd-bb20-42d71b26b1b4", { RepeatingInvoiceID: "f2301e59-0fb3-45cd-bb20-42d71b26b1b4", Status: "DELETED" });
});

// ── D2. Delete PF 13-weekly B2B (cadence mismatch vs GC monthly) — strict runtime match ──
await act("D2 DELETE Purple Fitness 13xWEEKLY $120.84 B2B (GC collects MONTHLY)", async () => {
  const cands = allRis.filter((r) =>
    r.Status === "AUTHORISED" &&
    r.Contact?.Name === "Purple Fitness Pty Ltd" &&
    r.Schedule?.Period === 13 && r.Schedule?.Unit === "WEEKLY" &&
    Math.abs(r.Total - 120.84) < 0.01);
  if (cands.length !== 1) throw new Error(`expected exactly 1 match, found ${cands.length} — skipped, needs manual look`);
  console.log(`      → pinned ${cands[0].RepeatingInvoiceID} (next ${xd(cands[0].Schedule?.NextScheduledDate)})`);
  await xeroPost(`RepeatingInvoices/${cands[0].RepeatingInvoiceID}`, { RepeatingInvoiceID: cands[0].RepeatingInvoiceID, Status: "DELETED" });
});

// ── C0. Glenmore Park contact ──
let glenmoreContactId = null;
await act("C0 create Xero contact 'Snap Fitness Glenmore Park' <snapbindiyaa@gmail.com>", async () => {
  // find-or-create by exact name (search confirmed none exists, but re-check to be idempotent)
  const found = (await (await fetch(`https://api.xero.com/api.xro/2.0/Contacts?where=${encodeURIComponent('Name=="Snap Fitness Glenmore Park"')}`, { headers: XH })).json()).Contacts ?? [];
  if (found.length > 0) { glenmoreContactId = found[0].ContactID; return `already exists ${glenmoreContactId}`; }
  const created = await xeroPost("Contacts", { Contacts: [{ Name: "Snap Fitness Glenmore Park", EmailAddress: "snapbindiyaa@gmail.com", IsCustomer: true }] });
  glenmoreContactId = created?.Contacts?.[0]?.ContactID;
  if (!glenmoreContactId) throw new Error("contact create returned no id");
  return glenmoreContactId;
});

// ── New-RI helper (fleet standard: AUTHORISED children, DD theme, auto-email, PDF, marked sent) ──
async function createRi({ contactId, reference, period, unit, startDate, theme, line }) {
  const body = {
    Type: "ACCREC",
    Contact: { ContactID: contactId },
    Schedule: { Period: period, Unit: unit, DueDate: 7, DueDateType: "DAYSAFTERBILLDATE", StartDate: startDate },
    LineItems: [line],
    LineAmountTypes: "Inclusive",
    Reference: reference,
    BrandingThemeID: theme,
    CurrencyCode: "AUD",
    Status: "AUTHORISED",
    ApprovedForSending: true,
    SendCopy: false,
    MarkAsSent: true,
    IncludePDF: true,
  };
  const created = await xeroPost("RepeatingInvoices", { RepeatingInvoices: [body] });
  const id = created?.RepeatingInvoices?.[0]?.RepeatingInvoiceID;
  if (!id) throw new Error("create returned no id");
  return id;
}

// ── C1-3. Glenmore Park RIs (plan d2ff7bba) ──
const glenmoreRef = "Plan d2ff7bba";
await act("C1 Glenmore B2B Monitoring $60.50/mo @ 2026-07-05 (SolutionsDD)", async () => {
  if (!glenmoreContactId) throw new Error("no contact id from C0");
  return await createRi({
    contactId: glenmoreContactId, reference: glenmoreRef, period: 1, unit: "MONTHLY", startDate: "2026-07-05", theme: THEME_SOLUTIONS_DD,
    line: { Description: "B2B - Alarm Monitoring Monthly", Quantity: 1, UnitAmount: 60.5, ItemCode: "B2BMTH", AccountCode: "209", TaxType: "OUTPUT" },
  });
});
await act("C2 Glenmore Duress SIM $24.75/mo @ 2026-07-05 (SolutionsDD)", async () => {
  if (!glenmoreContactId) throw new Error("no contact id from C0");
  return await createRi({
    contactId: glenmoreContactId, reference: glenmoreRef, period: 1, unit: "MONTHLY", startDate: "2026-07-05", theme: THEME_SOLUTIONS_DD,
    line: { Description: "4G Postpaid Phone SIM Card  for  Duress Intercom.", Quantity: 1, UnitAmount: 24.75, ItemCode: "4G Duress SIM", AccountCode: "207", TaxType: "OUTPUT" },
  });
});
await act("C3 Glenmore MyAlarm $146.85/yr @ 2027-05-26 (SolutionsDD)", async () => {
  if (!glenmoreContactId) throw new Error("no contact id from C0");
  return await createRi({
    contactId: glenmoreContactId, reference: glenmoreRef, period: 12, unit: "MONTHLY", startDate: "2027-05-26", theme: THEME_SOLUTIONS_DD,
    line: { Description: "MY ALARM  Security iFob App Subscription Fee", Quantity: 1, UnitAmount: 146.85, ItemCode: "MAMS", AccountCode: "208", TaxType: "OUTPUT" },
  });
});

// ── C4-6. Raby RIs (plan a7062f92, existing contact) ──
const RABY_CONTACT = "b7999068-9d8f-4ecf-8b4d-129fd4d26747";
const rabyRef = "Plan a7062f92";
await act("C4 Raby NBN GF-250/100 $139/mo @ 2026-07-13 (CommsDD)", async () =>
  await createRi({
    contactId: RABY_CONTACT, reference: rabyRef, period: 1, unit: "MONTHLY", startDate: "2026-07-13", theme: THEME_COMMS_DD,
    line: { Description: "NBN Plan - 250/100 (Grandfathered $139)", Quantity: 1, UnitAmount: 139, AccountCode: "204", TaxType: "OUTPUT" },
  }));
await act("C5 Raby Security Monitoring + SIM $85.25/mo @ 2026-07-12 (SolutionsDD)", async () =>
  await createRi({
    contactId: RABY_CONTACT, reference: rabyRef, period: 1, unit: "MONTHLY", startDate: "2026-07-12", theme: THEME_SOLUTIONS_DD,
    line: { Description: "Security Monitoring + SIM Card", Quantity: 1, UnitAmount: 85.25, AccountCode: "209", TaxType: "OUTPUT" },
  }));
await act("C6 Raby MyAlarm $146.85/yr @ 2026-11-24 (SolutionsDD)", async () =>
  await createRi({
    contactId: RABY_CONTACT, reference: rabyRef, period: 12, unit: "MONTHLY", startDate: "2026-11-24", theme: THEME_SOLUTIONS_DD,
    line: { Description: "MY ALARM  Security iFob App Subscription Fee", Quantity: 1, UnitAmount: 146.85, ItemCode: "MAMS", AccountCode: "208", TaxType: "OUTPUT" },
  }));

const ok = results.filter((r) => r.ok).length, fail = results.filter((r) => !r.ok).length;
console.log(`\nDone: ${ok} ok, ${fail} failed${DRY ? " (dry)" : ""}.`);
if (fail) process.exitCode = 1;
