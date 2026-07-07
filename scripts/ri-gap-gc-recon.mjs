// 2026-07-07 — RI gap remediation with GC truth-check.
// For each missed occurrence: verify GoCardless actually collected for that cycle.
//   CREATE = GC payment matches, no invoice -> backfill invoice (MarkAsSent, NO email)
//   SKIP   = no GC collection near date (consolidation/repricing artifact — nothing owed)
//   MANUAL = no GC link / amount mismatch / failed payment — Mitchell decides
// Default is report-only; pass --create to write the CREATE invoices to Xero.
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const CREATE = process.argv.includes("--create");

// (missedDate, total, contactNameHint, ref, liveRiId8) — from ri-gap-sweep 2026-07-07
const GAPS = [
  ["2026-06-01", 24.75, "Bellmere", "Duress Sim CFITQ64QWQV", "0fc8bba7"],
  ["2026-06-02", 129, "Total Fusion Chermside", "NBN - BCNBN-6433", "01393eb5"],
  ["2026-06-03", 145, "Ormeau", "Plan 57e52754", "f3046c80"],
  ["2026-06-05", 149, "Currimundi", "Plan 20fff819", "c1f71bee"],
  ["2026-06-05", 60.5, "Glenmore Park", "Plan d2ff7bba", "cb17d7db"],
  ["2026-06-05", 24.75, "Glenmore Park", "Plan d2ff7bba", "025ef65d"],
  ["2026-06-05", 85.25, "Preston", "Plan 4c6caf4f", "7818e664"],
  ["2026-06-07", 60.5, "Arana Hills", "Security Monitoring", "abd8199e"],
  ["2026-06-09", 290.25, "Marsden Park", "Plan a21146ba", "69db63c3"],
  ["2026-06-11", 66, "Newtown", "Voip Phones", "0be58f35"],
  ["2026-06-12", 85.25, "Raby", "Plan a7062f92", "35ea0852"],
  ["2026-06-13", 139, "Raby", "Plan a7062f92", "9dca013c"],
  ["2026-06-15", 24.75, "Purple Fitness", "Duress Sim CFIT H8DYYCQ", "0f2808ae"],
  ["2026-06-15", 24.75, "Mt Ommaney", "Duress Sim CFITHHFMCCQ", "28b35e6f"],
  ["2026-06-16", 139, "Beecroft", "NBN - BCNBN-6538  CFIT9M3T6KB", "6cff4446"],
  ["2026-06-19", 249, "Estella", "Plan 12eb8160", "b77d05c8"],
  ["2026-06-19", 24.75, "Victoria Point", "Duress Sim CFITFPXRSVR", "f73c524c"],
  ["2026-06-20", 24.75, "Strathpine", "SIM - CFIT GCPDHND", "5ac355ec"],
  ["2026-06-20", 53.9, "Strathpine", "Security Monitoring", "732479c0"],
  ["2026-06-22", 49.5, "Lutwyche", "Duress Sim CFITFPXRSVR", "bad463c6"],
  ["2026-06-29", 163.75, "Sippy Downs", "Plan a0e02ab8", "8ccf39ff"],
  ["2026-07-01", 139, "Pakenham", "NBN - CF8223", "97fadb6f"],
  ["2026-07-02", 60.5, "Total Fusion Chermside", "Security Monitoring", "8da40f02"],
  ["2026-07-02", 139, "Total Fusion Chermside", "NBN", "1b1ce29d"],
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

// Live RIs (need full ids + line items for creation)
const ris = ((await (await fetch("https://api.xero.com/api.xro/2.0/RepeatingInvoices", { headers: XH })).json()).RepeatingInvoices ?? [])
  .filter((r) => r.Type === "ACCREC" && r.Status === "AUTHORISED");
const riById8 = new Map(ris.map((r) => [r.RepeatingInvoiceID.slice(0, 8), r]));

// Plans: map RI id / contact id -> GC subs
const { data: plans } = await supabase.from("recurring_plans")
  .select("id, status, xero_repeating_invoice_id, xero_repeating_invoice_secondary_id, xero_contact_id, gc_subscription_id, gc_subscription_secondary_id");
const planForRi = (riId, contactId) =>
  plans.find((p) => p.xero_repeating_invoice_id === riId || p.xero_repeating_invoice_secondary_id === riId)
  ?? plans.find((p) => p.xero_contact_id === contactId);

// Fresh invoice coverage (all live statuses since May 20)
const invs = [];
for (let page = 1; ; page++) {
  const url = `https://api.xero.com/api.xro/2.0/Invoices?Statuses=DRAFT,SUBMITTED,AUTHORISED,PAID&where=${encodeURIComponent('Type=="ACCREC" AND Date>=DateTime(2026,5,20)')}&order=Date&page=${page}&pageSize=100`;
  const batch = (await (await fetch(url, { headers: XH })).json()).Invoices ?? [];
  invs.push(...batch);
  if (batch.length < 100) break;
  await sleep(600);
}

const gcPaymentsCache = new Map();
async function gcPayments(subId) {
  if (gcPaymentsCache.has(subId)) return gcPaymentsCache.get(subId);
  const res = await fetch(`${GC_BASE}/payments?subscription=${subId}&limit=100`, { headers: GCH });
  const j = await res.json();
  const pays = j.payments ?? [];
  gcPaymentsCache.set(subId, pays);
  await sleep(300);
  return pays;
}

const verdicts = [];
for (const [missed, total, hint, ref, ri8] of GAPS) {
  const ri = riById8.get(ri8);
  if (!ri) { verdicts.push({ missed, total, hint, ref, verdict: "MANUAL", why: "live RI not found" }); continue; }
  const cid = ri.Contact.ContactID;
  // still uncovered?
  const covered = invs.find((i) => i.Contact?.ContactID === cid && Math.abs(Number(i.Total) - total) < 0.01 && Math.abs(dayDiff(xd(i.Date), missed)) <= 10);
  if (covered) { verdicts.push({ missed, total, hint, ref, verdict: "SKIP", why: `now covered by ${covered.InvoiceNumber}` }); continue; }
  const plan = planForRi(ri.RepeatingInvoiceID, cid);
  const subs = [plan?.gc_subscription_id, plan?.gc_subscription_secondary_id].filter(Boolean);
  if (!subs.length) { verdicts.push({ missed, total, hint, ref, ri, verdict: "MANUAL", why: "no GC subscription linked (invoice-only or unmapped)" }); continue; }
  let hit = null, near = [];
  for (const s of subs) {
    for (const p of await gcPayments(s)) {
      const d = Math.abs(dayDiff(p.charge_date, missed));
      if (d <= 12) {
        near.push(`${p.charge_date} $${(p.amount / 100).toFixed(2)} ${p.status}`);
        if (Math.abs(p.amount - Math.round(total * 100)) < 2 && ["pending_submission", "submitted", "confirmed", "paid_out"].includes(p.status)) hit = p;
      }
    }
  }
  if (hit) verdicts.push({ missed, total, hint, ref, ri, verdict: "CREATE", why: `GC collected ${hit.charge_date} $${(hit.amount / 100).toFixed(2)} (${hit.status})` });
  else if (near.length) verdicts.push({ missed, total, hint, ref, ri, verdict: "MANUAL", why: `GC activity near date but no clean match: ${near.join("; ")}` });
  else verdicts.push({ missed, total, hint, ref, verdict: "SKIP", why: "no GC collection near date — nothing was charged" });
}

console.log(`=== verdicts ===`);
for (const v of verdicts) console.log(`${v.verdict.padEnd(7)} ${v.missed}  $${String(v.total).padEnd(8)} ${v.hint.padEnd(24)} "${v.ref}"  — ${v.why}`);
const creates = verdicts.filter((v) => v.verdict === "CREATE");
console.log(`\nCREATE=${creates.length} ($${creates.reduce((s, v) => s + v.total, 0).toFixed(2)})  SKIP=${verdicts.filter((v) => v.verdict === "SKIP").length}  MANUAL=${verdicts.filter((v) => v.verdict === "MANUAL").length}`);

if (CREATE && creates.length) {
  console.log(`\n=== creating ${creates.length} invoices (AUTHORISED, marked sent, NO email) ===`);
  for (const v of creates) {
    const ri = v.ri;
    const due = ri.Schedule?.DueDateType === "DAYSAFTERBILLDATE" ? Math.max(1, ri.Schedule.DueDate ?? 7) : 7;
    const dueDate = new Date(Date.parse(v.missed) + due * 86400000).toISOString().slice(0, 10);
    const body = {
      Invoices: [{
        Type: "ACCREC",
        Contact: { ContactID: ri.Contact.ContactID },
        Date: v.missed,
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
        SentToContact: true,
      }],
    };
    const res = await fetch("https://api.xero.com/api.xro/2.0/Invoices?summarizeErrors=false", { method: "POST", headers: XH, body: JSON.stringify(body) });
    const j = await res.json();
    const inv = j?.Invoices?.[0];
    const ve = inv?.ValidationErrors?.map((e) => e.Message).join("; ");
    if (!res.ok || ve) console.log(`FAIL  ${v.missed} ${v.hint} $${v.total} — ${ve ?? `HTTP ${res.status}`}`);
    else if (Math.abs(Number(inv.Total) - v.total) > 0.01) console.log(`WARN  ${inv.InvoiceNumber} total $${inv.Total} != expected $${v.total} — REVIEW (created)`);
    else console.log(`OK    ${inv.InvoiceNumber}  ${v.missed}  $${inv.Total}  ${v.hint}`);
    await sleep(1100);
  }
}
