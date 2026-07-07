// 2026-07-07 — RI gap recon v2: match gaps against the FULL GC payment ledger (payments->mandate->customer),
// so legacy/unmapped RIs resolve too. Verdicts:
//   CREATE           GC collected the RI amount, no invoice -> backfill at RI lines
//   CREATE_COLLECTED GC collected a DIFFERENT amount (price change) -> backfill from deleted RI lineage at that amount
//   TF_OWED          Total Fusion (invoice-only, no DD ever) -> owed, create + actually email
//   SKIP             no GC collection near date -> nothing charged, backfill would overbill
//   MANUAL           ambiguous -> Mitchell
// Report-only unless --create.
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const CREATE = process.argv.includes("--create");

const GAPS = [
  ["2026-06-01", 24.75, "Bellmere", "0fc8bba7"],
  ["2026-06-02", 129, "Total Fusion Chermside", "01393eb5"],
  ["2026-06-03", 145, "Ormeau", "f3046c80"],
  ["2026-06-05", 149, "Currimundi", "c1f71bee"],
  ["2026-06-05", 60.5, "Glenmore Park", "cb17d7db"],
  ["2026-06-05", 24.75, "Glenmore Park", "025ef65d"],
  ["2026-06-05", 85.25, "Preston", "7818e664"],
  ["2026-06-07", 60.5, "Arana Hills", "abd8199e"],
  ["2026-06-09", 290.25, "Marsden Park", "69db63c3"],
  ["2026-06-11", 66, "Newtown", "0be58f35"],
  ["2026-06-12", 85.25, "Raby", "35ea0852"],
  ["2026-06-13", 139, "Raby", "9dca013c"],
  ["2026-06-15", 24.75, "Purple Fitness", "0f2808ae"],
  ["2026-06-15", 24.75, "Mt Ommaney", "28b35e6f"],
  ["2026-06-16", 139, "Beecroft", "6cff4446"],
  ["2026-06-19", 249, "Estella", "b77d05c8"],
  ["2026-06-19", 24.75, "Victoria Point", "f73c524c"],
  ["2026-06-20", 24.75, "Strathpine", "5ac355ec"],
  ["2026-06-20", 53.9, "Strathpine", "732479c0"],
  ["2026-06-22", 49.5, "Lutwyche", "bad463c6"],
  ["2026-06-29", 163.75, "Sippy Downs", "8ccf39ff"],
  ["2026-07-01", 139, "Pakenham", "97fadb6f"],
  ["2026-07-02", 60.5, "Total Fusion Chermside", "8da40f02"],
  ["2026-07-02", 139, "Total Fusion Chermside", "1b1ce29d"],
];

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
const GCH = { Authorization: `Bearer ${env.GOCARDLESS_API_TOKEN}`, "GoCardless-Version": "2015-07-06", Accept: "application/json" };
const GC_BASE = env.GOCARDLESS_ENVIRONMENT === "sandbox" ? "https://api-sandbox.gocardless.com" : "https://api.gocardless.com";
const xd = (ms) => { const m = /\/Date\((\d+)/.exec(ms ?? ""); return m ? new Date(Number(m[1])).toISOString().slice(0, 10) : null; };
const dayDiff = (a, b) => Math.round((Date.parse(a) - Date.parse(b)) / 86400000);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function gcList(path, params) {
  const out = [];
  let after;
  for (;;) {
    const q = new URLSearchParams({ limit: "500", ...params, ...(after ? { after } : {}) });
    const j = await (await fetch(`${GC_BASE}/${path}?${q}`, { headers: GCH })).json();
    const key = path.split("?")[0];
    out.push(...(j[key] ?? []));
    after = j.meta?.cursors?.after;
    if (!after) break;
    await sleep(300);
  }
  return out;
}

// GC ledger
const [payments, mandates, customers] = [
  await gcList("payments", { "charge_date[gte]": "2026-05-20", "charge_date[lte]": "2026-07-10" }),
  await gcList("mandates", {}),
  await gcList("customers", {}),
];
const custById = new Map(customers.map((c) => [c.id, c]));
const mandById = new Map(mandates.map((m) => [m.id, m]));
const payCustName = (p) => {
  const m = mandById.get(p.links?.mandate);
  const c = m ? custById.get(m.links?.customer) : null;
  return c ? `${c.company_name ?? ""} ${c.given_name ?? ""} ${c.family_name ?? ""}`.trim() : "?";
};
console.log(`GC ledger: ${payments.length} payments, ${mandates.length} mandates, ${customers.length} customers`);

// Xero RIs (ALL statuses, for lineage) + fresh coverage
const risAll = ((await (await fetch("https://api.xero.com/api.xro/2.0/RepeatingInvoices", { headers: XH })).json()).RepeatingInvoices ?? []).filter((r) => r.Type === "ACCREC");
const riById8 = new Map(risAll.filter((r) => r.Status === "AUTHORISED").map((r) => [r.RepeatingInvoiceID.slice(0, 8), r]));
const invs = [];
for (let page = 1; ; page++) {
  const url = `https://api.xero.com/api.xro/2.0/Invoices?Statuses=DRAFT,SUBMITTED,AUTHORISED,PAID&where=${encodeURIComponent('Type=="ACCREC" AND Date>=DateTime(2026,5,20)')}&order=Date&page=${page}&pageSize=100`;
  const batch = (await (await fetch(url, { headers: XH })).json()).Invoices ?? [];
  invs.push(...batch);
  if (batch.length < 100) break;
  await sleep(600);
}

// Post-probe overrides (2026-07-07): "mt" token falsely matched Mt Druitt — Ommaney had NO collection.
// Estella: consolidated $249 RI, but GC collected split amounts ($60.5 x2 on 6-11 [one is a suspected
// double-charge], $139 + $49.5 on 6-19) — backfill the three legit ones from deleted RI lineage.
const OVERRIDES = {
  "2026-06-15|28b35e6f": { verdict: "MANUAL", why: "NO GC collection for Mt Ommaney (probe: no Ommaney customer payment mid-June) — check GC sub exists at all (possible revenue leak)" },
  "2026-06-19|b77d05c8": { verdict: "MANUAL", why: "consolidated $249 RI; GC collected split: $60.5 x2 (6-11, one suspected DOUBLE-CHARGE -> refund decision) + $139 & $49.5 (6-19). Legit three backfilled via EXTRA." },
};
// Explicit extra creations from deleted-RI lineage (contactRi8 = live RI to resolve the contact)
const EXTRA = [
  { date: "2026-06-11", amount: 60.5, hint: "Estella (monitoring)", contactRi8: "b77d05c8" },
  { date: "2026-06-19", amount: 139, hint: "Estella (NBN)", contactRi8: "b77d05c8" },
  { date: "2026-06-19", amount: 49.5, hint: "Estella (duress)", contactRi8: "b77d05c8" },
];

const verdicts = [];
for (const [missed, total, hint, ri8] of GAPS) {
  const ov = OVERRIDES[`${missed}|${ri8}`];
  if (ov) { verdicts.push({ missed, total, hint, ...ov }); continue; }
  const ri = riById8.get(ri8);
  if (!ri) { verdicts.push({ missed, total, hint, verdict: "MANUAL", why: "live RI not found" }); continue; }
  const cid = ri.Contact.ContactID;
  const covered = invs.find((i) => i.Contact?.ContactID === cid && Math.abs(Number(i.Total) - total) < 0.01 && Math.abs(dayDiff(xd(i.Date), missed)) <= 10);
  if (covered) { verdicts.push({ missed, total, hint, verdict: "SKIP", why: `now covered by ${covered.InvoiceNumber}` }); continue; }
  if (hint.startsWith("Total Fusion")) { verdicts.push({ missed, total, hint, ri, verdict: "TF_OWED", why: "invoice-only client; service continuous" }); continue; }

  // GC payments for customers whose name matches the site hint
  const token = hint.split(" ")[0].toLowerCase(); // Bellmere / Ormeau / Currimundi ... distinctive suburb tokens
  const cand = payments.filter((p) => Math.abs(dayDiff(p.charge_date, missed)) <= 12 && payCustName(p).toLowerCase().includes(token));
  const clean = cand.filter((p) => ["pending_submission", "submitted", "confirmed", "paid_out"].includes(p.status));
  const exact = clean.filter((p) => Math.abs(p.amount - Math.round(total * 100)) < 2);
  if (exact.length >= 1) {
    verdicts.push({ missed, total, hint, ri, verdict: "CREATE", why: `GC ${exact[0].charge_date} $${(exact[0].amount / 100).toFixed(2)} ${exact[0].status} [${payCustName(exact[0])}]` });
    continue;
  }
  if (clean.length) {
    // price-change case: single clean payment at a different amount, with a deleted RI at that amount for lineage
    const amounts = [...new Set(clean.map((p) => p.amount))];
    // exclude payments that already have a matching invoice (they belong to a sibling service)
    const unexplained = clean.filter((p) => !invs.find((i) => i.Contact?.ContactID === cid && Math.abs(Number(i.Total) - p.amount / 100) < 0.01 && Math.abs(dayDiff(xd(i.Date), p.charge_date)) <= 10));
    if (unexplained.length === 1) {
      const p = unexplained[0];
      const lineage = risAll.find((r) => r.Contact?.ContactID === cid && Math.abs(r.Total - p.amount / 100) < 0.01);
      if (lineage) { verdicts.push({ missed, total: p.amount / 100, hint, ri: lineage, useDate: p.charge_date, verdict: "CREATE_COLLECTED", why: `GC ${p.charge_date} $${(p.amount / 100).toFixed(2)} ${p.status}; lines from RI ${lineage.RepeatingInvoiceID.slice(0, 8)} (${lineage.Status})` }); continue; }
      verdicts.push({ missed, total, hint, verdict: "MANUAL", why: `GC collected $${(p.amount / 100).toFixed(2)} on ${p.charge_date} but no RI lineage at that amount` }); continue;
    }
    verdicts.push({ missed, total, hint, verdict: unexplained.length ? "MANUAL" : "SKIP", why: unexplained.length ? `multiple unexplained GC payments: ${unexplained.map((p) => `${p.charge_date} $${p.amount / 100}`).join("; ")}` : `GC activity all matches existing invoices (amounts: ${amounts.map((a) => "$" + a / 100).join(", ")})` });
    continue;
  }
  verdicts.push({ missed, total, hint, verdict: "SKIP", why: "no GC collection near date for this site — nothing charged" });
}

console.log(`\n=== verdicts ===`);
for (const v of verdicts) console.log(`${v.verdict.padEnd(17)} ${v.missed}  $${String(v.total).padEnd(8)} ${v.hint.padEnd(24)} — ${v.why}`);
const doable = verdicts.filter((v) => ["CREATE", "CREATE_COLLECTED", "TF_OWED"].includes(v.verdict));
console.log(`\ncreate=${doable.length} ($${doable.reduce((s, v) => s + v.total, 0).toFixed(2)})  skip=${verdicts.filter((v) => v.verdict === "SKIP").length}  manual=${verdicts.filter((v) => v.verdict === "MANUAL").length}`);

// Resolve EXTRA lineage creations
const extraJobs = [];
for (const x of EXTRA) {
  const anchor = riById8.get(x.contactRi8);
  if (!anchor) { console.log(`EXTRA ${x.hint}: anchor RI not found`); continue; }
  const cid = anchor.Contact.ContactID;
  const already = invs.find((i) => i.Contact?.ContactID === cid && Math.abs(Number(i.Total) - x.amount) < 0.01 && Math.abs(dayDiff(xd(i.Date), x.date)) <= 10);
  if (already) { console.log(`EXTRA ${x.hint}: already covered by ${already.InvoiceNumber}`); continue; }
  const lineage = risAll.find((r) => r.Contact?.ContactID === cid && Math.abs(r.Total - x.amount) < 0.01);
  if (!lineage) { console.log(`EXTRA ${x.hint}: no RI lineage at $${x.amount} — MANUAL`); continue; }
  extraJobs.push({ missed: x.date, total: x.amount, hint: x.hint, ri: lineage, useDate: x.date, verdict: "CREATE_COLLECTED", why: `Estella split backfill (lineage ${lineage.RepeatingInvoiceID.slice(0, 8)} ${lineage.Status})` });
}
if (extraJobs.length) console.log(`extra lineage creations resolved: ${extraJobs.length}`);
doable.push(...extraJobs);

if (CREATE && doable.length) {
  console.log(`\n=== creating ${doable.length} invoices ===`);
  for (const v of doable) {
    const ri = v.ri;
    const invDate = v.useDate ?? v.missed;
    const due = ri.Schedule?.DueDateType === "DAYSAFTERBILLDATE" ? Math.max(1, ri.Schedule.DueDate ?? 7) : 7;
    const dueDate = new Date(Date.parse(invDate) + due * 86400000).toISOString().slice(0, 10);
    const body = {
      Invoices: [{
        Type: "ACCREC",
        Contact: { ContactID: ri.Contact.ContactID },
        Date: invDate,
        DueDate: dueDate,
        LineItems: (ri.LineItems ?? []).map((l) => ({
          Description: l.Description, Quantity: l.Quantity, UnitAmount: l.UnitAmount,
          ...(l.ItemCode ? { ItemCode: l.ItemCode } : {}), AccountCode: l.AccountCode, TaxType: l.TaxType,
        })),
        LineAmountTypes: ri.LineAmountTypes,
        ...(ri.Reference ? { Reference: ri.Reference } : {}),
        BrandingThemeID: ri.BrandingThemeID,
        CurrencyCode: "AUD",
        Status: "AUTHORISED",
        SentToContact: v.verdict !== "TF_OWED",
      }],
    };
    const res = await fetch("https://api.xero.com/api.xro/2.0/Invoices?summarizeErrors=false", { method: "POST", headers: XH, body: JSON.stringify(body) });
    const j = await res.json();
    const inv = j?.Invoices?.[0];
    const ve = inv?.ValidationErrors?.map((e) => e.Message).join("; ");
    if (!res.ok || ve) { console.log(`FAIL  ${invDate} ${v.hint} $${v.total} — ${ve ?? `HTTP ${res.status}`}`); continue; }
    if (Math.abs(Number(inv.Total) - v.total) > 0.01) { console.log(`WARN  ${inv.InvoiceNumber} total $${inv.Total} != $${v.total} — REVIEW`); continue; }
    let mailed = "";
    if (v.verdict === "TF_OWED") {
      const em = await fetch(`https://api.xero.com/api.xro/2.0/Invoices/${inv.InvoiceID}/Email`, { method: "POST", headers: XH, body: "{}" });
      mailed = em.status === 204 ? " + emailed" : ` + EMAIL FAILED ${em.status}`;
    }
    console.log(`OK    ${inv.InvoiceNumber}  ${invDate}  $${inv.Total}  ${v.hint}${mailed}`);
    await sleep(1100);
  }
}
