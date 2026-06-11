// Batch (Mitchell-authorised 2026-06-11 evening):
//  A. Grandfathered 250/100 @ $139: catalogue entry + DD plan items + Xero
//     RI line wording for accelerated circuits billed as 100/40 $139.
//  B. Currimundi RI line → 250/100 $149 (queued from yesterday).
//  C. Watagan Park re-date: monthly DD → 2026-06-20, yearly → 2026-12-01,
//     across GC subs (cancel+recreate), Xero RIs (delete+recreate) and CRM.
//     Old generated child invoices: drafts deleted, authorised voided.
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const env = Object.fromEntries(
  readFileSync(new URL("../.env.gc-probe", import.meta.url), "utf8")
    .split("\n").filter((l) => l.includes("="))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, "").replace(/\\r|\\n/g, "").trim()]; }),
);
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const GC = { Authorization: `Bearer ${env.GOCARDLESS_API_TOKEN}`, "GoCardless-Version": "2015-07-06", Accept: "application/json", "Content-Type": "application/json" };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── Xero auth ────────────────────────────────────────────────────────────────
const { data: conn } = await sb.from("xero_connections").select("id, tenant_id, access_token, refresh_token, expires_at").order("updated_at", { ascending: false }).limit(1).single();
let tok = conn.access_token;
if (!conn.expires_at || new Date(conn.expires_at).getTime() < Date.now() + 60000) {
  const res = await fetch("https://identity.xero.com/connect/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Authorization: "Basic " + Buffer.from(`${env.XERO_CLIENT_ID}:${env.XERO_CLIENT_SECRET}`).toString("base64") },
    body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: conn.refresh_token }),
  });
  const t = await res.json();
  tok = t.access_token;
  await sb.from("xero_connections").update({ access_token: t.access_token, refresh_token: t.refresh_token ?? conn.refresh_token, expires_at: new Date(Date.now() + (t.expires_in ?? 1800) * 1000).toISOString(), updated_at: new Date().toISOString() }).eq("id", conn.id);
}
const XH = { Authorization: `Bearer ${tok}`, "Xero-tenant-id": conn.tenant_id, Accept: "application/json", "Content-Type": "application/json" };
async function xero(path, method = "GET", body) {
  for (let a = 0; a < 4; a++) {
    const res = await fetch(`https://api.xero.com/api.xro/2.0/${path}`, { method, headers: XH, body: body ? JSON.stringify(body) : undefined });
    if (res.status === 429) { await sleep((Number(res.headers.get("retry-after") ?? 6) + 1) * 1000); continue; }
    const text = await res.text();
    let j = null; try { j = text ? JSON.parse(text) : null; } catch { /* */ }
    if (!res.ok) throw new Error(`${method} ${path} → ${res.status}: ${(j?.Elements?.[0]?.ValidationErrors?.map((v) => v.Message).join("; ")) ?? text.slice(0, 180)}`);
    return j;
  }
  throw new Error("rate-limited");
}
const xd = (ms) => { const m = /\/Date\((\d+)/.exec(ms ?? ""); return m ? new Date(Number(m[1])).toISOString().slice(0, 10) : undefined; };

const GF_NAME = "NBN Plan - 250/100 (Grandfathered $139)";

// ═══ A1. catalogue entry ═════════════════════════════════════════════════════
const { data: gfSvc } = await sb.from("recurring_services")
  .upsert({ code: "nbn-250-100-gf", name: GF_NAME, description: "NBN-accelerated circuit (free speed upgrade) kept at the customer's original 100/40 price. Grandfathered — do NOT sell to new customers (new sales: nbn-250-100 at $149).", price_inc_gst: 139, frequency: "monthly", active: true, sort_order: 7, account_code: "204" }, { onConflict: "code" })
  .select("id").single();
console.log(`A1. catalogue: nbn-250-100-gf (${gfSvc.id})`);

// ═══ A2. DD plan items (accelerated circuits billed 100/40 @ 139) ════════════
const DD_SITES = ["Sunshine", "Charlemont Rise", "Raby", "Kingston", "Browns Plains", "Glen Waverley", "Arana Hills", "Hampton", "Pakenham", "Oakleigh South", "Armadale", "Plainland", "Moorebank", "Chermside", "Bentleigh East", "Bellmere", "Mt Ommaney", "Estella", "Beecroft", "Meadowbank"];
const { data: plans } = await sb.from("recurring_plans")
  .select("id, customer_sites(name), recurring_plan_items(id, service_name, service_code, price_inc_gst, frequency)")
  .eq("status", "active");
let itemCount = 0;
for (const p of plans ?? []) {
  const site = (Array.isArray(p.customer_sites) ? p.customer_sites[0] : p.customer_sites)?.name ?? "";
  if (!DD_SITES.some((s) => site.toLowerCase().includes(s.toLowerCase()))) continue;
  const item = (p.recurring_plan_items ?? []).find((i) => i.frequency === "monthly" && Number(i.price_inc_gst) === 139 && /100\s*\/\s*40|nbn-100-40|nbn 100/i.test(`${i.service_code} ${i.service_name}`));
  if (!item) continue;
  await sb.from("recurring_plan_items").update({ service_id: gfSvc.id, service_code: "nbn-250-100-gf", service_name: GF_NAME, description: null }).eq("id", item.id);
  itemCount++;
  console.log(`A2. ${site}: "${item.service_name}" → GF 250/100 ($139 unchanged)`);
}
console.log(`A2. ${itemCount} DD plan items grandfathered (GC subs untouched — same $)`);

// ═══ A3 + B. Xero RI line swaps ══════════════════════════════════════════════
const allRis = (await xero("RepeatingInvoices")).RepeatingInvoices.filter((r) => r.Status === "AUTHORISED" && r.Type === "ACCREC");
async function swapRi(ri, mutateLines, label) {
  const body = {
    Type: "ACCREC",
    Contact: { ContactID: ri.Contact.ContactID },
    Schedule: {
      Period: ri.Schedule.Period, Unit: ri.Schedule.Unit,
      DueDate: ri.Schedule.DueDateType === "DAYSAFTERBILLDATE" ? Math.max(1, ri.Schedule.DueDate ?? 1) : ri.Schedule.DueDate,
      DueDateType: ri.Schedule.DueDateType,
      StartDate: xd(ri.Schedule.NextScheduledDate),
    },
    LineItems: (ri.LineItems ?? []).map((l) => {
      const c = { Description: l.Description, Quantity: l.Quantity, UnitAmount: l.UnitAmount, AccountCode: l.AccountCode, TaxType: l.TaxType };
      return mutateLines(c);
    }),
    LineAmountTypes: ri.LineAmountTypes,
    ...(ri.Reference ? { Reference: ri.Reference } : {}),
    BrandingThemeID: ri.BrandingThemeID,
    CurrencyCode: ri.CurrencyCode,
    Status: "AUTHORISED",
    ApprovedForSending: ri.ApprovedForSending ?? false,
    SendCopy: ri.SendCopy ?? false,
    MarkAsSent: true, IncludePDF: true,
  };
  const created = await xero("RepeatingInvoices", "POST", { RepeatingInvoices: [body] });
  const newId = created.RepeatingInvoices[0].RepeatingInvoiceID;
  await sleep(1100);
  await xero(`RepeatingInvoices/${ri.RepeatingInvoiceID}`, "POST", { RepeatingInvoiceID: ri.RepeatingInvoiceID, Status: "DELETED" });
  await sleep(1100);
  console.log(`${label} — swapped (new ${newId.slice(0, 8)}…)`);
  return newId;
}

const GF_CONTACTS = [/dwsft/i, /bomaderry/i, /new farm/i, /coniston/i, /marsden park/i, /kiama/i, /tawa|blacktown/i, /brighton/i, /ivory swan|vasse/i, /kalkallo|siri international/i];
for (const re of GF_CONTACTS) {
  const ri = allRis.find((r) => re.test(r.Contact?.Name ?? "") && (r.LineItems ?? []).some((l) => /100\s*\/\s*40/i.test(l.Description ?? "") && Math.abs((l.LineAmount ?? 0) - 139) < 1));
  if (!ri) { console.log(`A3. no matching 100/40@$139 RI for ${re} — skipped`); continue; }
  await swapRi(ri, (l) => { if (/100\s*\/\s*40/i.test(l.Description)) l.Description = GF_NAME; return l; }, `A3. ${ri.Contact.Name} $139`);
}

// B. Currimundi: line → 250/100 @ $149
const curRi = allRis.find((r) => r.RepeatingInvoiceID === "02f39a21-c7b4-4468-b511-4272cb04301e");
if (curRi) {
  const newCurId = await swapRi(curRi, (l) => { if (/nbn|100\/40/i.test(l.Description)) { l.Description = "NBN Plan - 250/100"; l.UnitAmount = 149; } return l; }, "B. Currimundi → 250/100 $149");
  await sb.from("recurring_plans").update({ xero_repeating_invoice_id: newCurId, updated_at: new Date().toISOString() }).eq("id", "20fff819-30c8-4c4b-ad71-e07c64772036");
} else console.log("B. Currimundi RI not found (already swapped?)");

// ═══ C. Watagan Park re-date ═════════════════════════════════════════════════
const W = {
  planId: "6a74bef9-5a1c-4e4d-ac3c-3b7be463a562",
  mandate: "MD01KTTKBXWCWXXANVDAZ6MBS6MP",
  monthlySub: "SB01KTTQV7F8HAJ7MQTWSEDFSJKY",
  yearlySub: "SB01KTTQV7NCCZJ0BEJTGPR9WE1H",
  monthlyRi: "bbf801b0-e3f6-40ec-8f2c-525609b8dcc3",
  yearlyRi: "d21f53e4-98f5-42f0-bed7-a050155425e9",
  contact: "870d75e9-917c-4d31-af05-67206b96d7d9",
  monthlyStart: "2026-06-20",
  yearlyStart: "2026-12-01",
};

// C1. GC subs: cancel + recreate on the requested dates
for (const [sid, label] of [[W.monthlySub, "monthly"], [W.yearlySub, "yearly"]]) {
  const r = await fetch(`https://api.gocardless.com/subscriptions/${sid}/actions/cancel`, { method: "POST", headers: GC });
  const j = await r.json();
  console.log(`C1. cancel ${label} ${sid} → ${j.subscriptions?.status ?? JSON.stringify(j.error?.message)}`);
}
async function gcCreateSub(amountCents, unit, start, name, key) {
  const r = await fetch("https://api.gocardless.com/subscriptions", {
    method: "POST", headers: { ...GC, "Idempotency-Key": key },
    body: JSON.stringify({ subscriptions: { amount: amountCents, currency: "AUD", interval_unit: unit, start_date: start, name, metadata: { plan_id: W.planId, source: "redate-2026-06-11" }, links: { mandate: W.mandate } } }),
  });
  const j = await r.json();
  if (!j.subscriptions?.id) throw new Error(`sub create failed: ${JSON.stringify(j).slice(0, 250)}`);
  console.log(`C1. created ${j.subscriptions.id} $${amountCents / 100}/${unit} start ${j.subscriptions.start_date}`);
  return j.subscriptions;
}
const newMonthly = await gcCreateSub(22425, "monthly", W.monthlyStart, "Snap Fitness Watagan Park (monthly)", `watagan-monthly-${W.monthlyStart}`);
const newYearly = await gcCreateSub(14685, "yearly", W.yearlyStart, "Snap Fitness Watagan Park (yearly)", `watagan-yearly-${W.yearlyStart}`);

// C2. Xero: child invoices from the old RIs → delete drafts / void authorised
const inv = await xero(`Invoices?where=${encodeURIComponent(`Contact.ContactID=Guid("${W.contact}")`)}&order=Date%20DESC`);
for (const i of inv.Invoices ?? []) {
  if (i.Status === "DRAFT") {
    await xero(`Invoices/${i.InvoiceID}`, "POST", { InvoiceID: i.InvoiceID, Status: "DELETED" });
    console.log(`C2. child ${i.InvoiceNumber ?? i.InvoiceID} (DRAFT $${i.Total}) → DELETED`);
  } else if (i.Status === "AUTHORISED" && (i.AmountPaid ?? 0) === 0) {
    await xero(`Invoices/${i.InvoiceID}`, "POST", { InvoiceID: i.InvoiceID, Status: "VOIDED" });
    console.log(`C2. child ${i.InvoiceNumber} (AUTHORISED $${i.Total}) → VOIDED`);
  } else {
    console.log(`C2. child ${i.InvoiceNumber} [${i.Status}] $${i.Total} paid=$${i.AmountPaid} — left alone, review`);
  }
  await sleep(900);
}

// C3. Xero: recreate the two RIs on the new dates, delete old
let newMonthlyRi = null, newYearlyRi = null;
for (const [riId, start, slot] of [[W.monthlyRi, W.monthlyStart, "monthly"], [W.yearlyRi, W.yearlyStart, "yearly"]]) {
  const ri = allRis.find((r) => r.RepeatingInvoiceID === riId);
  if (!ri) { console.log(`C3. RI ${riId} not found — skipped`); continue; }
  const body = {
    Type: "ACCREC",
    Contact: { ContactID: ri.Contact.ContactID },
    Schedule: { Period: ri.Schedule.Period, Unit: ri.Schedule.Unit, DueDate: Math.max(1, ri.Schedule.DueDate ?? 7), DueDateType: ri.Schedule.DueDateType, StartDate: start },
    LineItems: (ri.LineItems ?? []).map((l) => ({ Description: l.Description, Quantity: l.Quantity, UnitAmount: l.UnitAmount, AccountCode: l.AccountCode, TaxType: l.TaxType })),
    LineAmountTypes: ri.LineAmountTypes,
    ...(ri.Reference ? { Reference: ri.Reference } : {}),
    BrandingThemeID: ri.BrandingThemeID, CurrencyCode: ri.CurrencyCode,
    Status: "AUTHORISED", ApprovedForSending: ri.ApprovedForSending ?? false, SendCopy: ri.SendCopy ?? false, MarkAsSent: true, IncludePDF: true,
  };
  const created = await xero("RepeatingInvoices", "POST", { RepeatingInvoices: [body] });
  const newId = created.RepeatingInvoices[0].RepeatingInvoiceID;
  await sleep(1100);
  await xero(`RepeatingInvoices/${riId}`, "POST", { RepeatingInvoiceID: riId, Status: "DELETED" });
  await sleep(1100);
  if (slot === "monthly") newMonthlyRi = newId; else newYearlyRi = newId;
  console.log(`C3. ${slot} RI recreated start ${start} (new ${newId.slice(0, 8)}…), old deleted`);
}

// C4. CRM record
const now = new Date().toISOString();
await sb.from("recurring_plans").update({
  gc_subscription_id: newMonthly.id,
  gc_subscription_secondary_id: newYearly.id,
  ...(newMonthlyRi ? { xero_repeating_invoice_id: newMonthlyRi } : {}),
  ...(newYearlyRi ? { xero_repeating_invoice_secondary_id: newYearlyRi } : {}),
  next_invoice_date: W.monthlyStart,
  first_invoice_date: W.monthlyStart,
  yearly_first_invoice_date: W.yearlyStart,
  updated_at: now,
}).eq("id", W.planId);
await sb.from("recurring_plan_gc_subscriptions").update({ gc_status: "cancelled", updated_at: now }).in("gc_subscription_id", [W.monthlySub, W.yearlySub]);
for (const s of [newMonthly, newYearly]) {
  await sb.from("recurring_plan_gc_subscriptions").insert({
    plan_id: W.planId, gc_subscription_id: s.id, name: s.name, amount_cents: s.amount, currency: "AUD",
    interval_unit: s.interval_unit, interval: 1, start_date: s.start_date, gc_status: s.status, source: "crm",
  });
}
console.log("C4. CRM plan re-dated: monthly 2026-06-20, yearly 2026-12-01. Done.");
