// 2026-09-23 — READ-ONLY probe for the GoCardless payout reconciliation agent.
//   1. Xero 602 Group account: unreconciled statement lines since 1 Jul, which of
//      them are GoCardless payouts (net amounts landing directly — no clearing acct).
//   2. GoCardless: payouts over the same window (net, fees, arrival date), matched
//      to the Xero feed lines by amount + date → "in feed / reconciled?" per payout.
//   3. For the first two UNRECONCILED payouts: payout_items → payments → subscription
//      → CRM plan link, to show the customer/invoice mapping resolves without a spreadsheet.
// Writes nothing anywhere. Run: node scripts/gc-payout-recon-probe.mjs
import { readFileSync, existsSync, writeFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const envFile = ["../.env.gc-probe", "../.env.local"].map((p) => new URL(p, import.meta.url)).find((u) => existsSync(u));
if (!envFile) { console.error("no .env.gc-probe / .env.local"); process.exit(1); }
const env = Object.fromEntries(
  readFileSync(envFile, "utf8").split("\n").filter((l) => l.includes("=") && !l.startsWith("#"))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, "").replace(/\\r|\\n/g, "").trim()]; }),
);
for (const k of ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "XERO_CLIENT_ID", "XERO_CLIENT_SECRET", "GOCARDLESS_API_TOKEN"]) {
  if (!env[k]) { console.error(`missing ${k} in ${envFile.pathname}`); process.exit(1); }
}
const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

// ---- Xero auth (same pattern as xero-bank-rec-gap-audit.mjs) ----
const { data: conn, error } = await supabase.from("xero_connections").select("id, tenant_id, access_token, refresh_token, expires_at").order("updated_at", { ascending: false }).limit(1).single();
if (error || !conn) { console.error("No Xero connection:", error?.message); process.exit(1); }
let accessToken = conn.access_token;
try { const jwt = JSON.parse(Buffer.from(conn.access_token.split(".")[1], "base64url").toString()); const sc = Array.isArray(jwt.scope) ? jwt.scope : String(jwt.scope).split(" "); console.log(`token scopes: ${sc.filter((s) => s.startsWith("accounting")).join(" ")}`); } catch {}
if (!conn.expires_at || new Date(conn.expires_at).getTime() < Date.now() + 60_000) {
  const res = await fetch("https://identity.xero.com/connect/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Authorization: "Basic " + Buffer.from(`${env.XERO_CLIENT_ID}:${env.XERO_CLIENT_SECRET}`).toString("base64") },
    body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: conn.refresh_token }),
  });
  const tok = await res.json();
  if (!res.ok) { console.error("Token refresh failed:", JSON.stringify(tok)); process.exit(1); }
  accessToken = tok.access_token;
  await supabase.from("xero_connections").update({ access_token: tok.access_token, refresh_token: tok.refresh_token ?? conn.refresh_token, expires_at: new Date(Date.now() + (tok.expires_in ?? 1800) * 1000).toISOString(), updated_at: new Date().toISOString() }).eq("id", conn.id);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const xeroGet = async (path) => {
  for (let attempt = 1; attempt <= 4; attempt++) {
    const res = await fetch(`https://api.xero.com/api.xro/2.0/${path}`, { headers: { Authorization: `Bearer ${accessToken}`, "Xero-tenant-id": conn.tenant_id, Accept: "application/json" } });
    if (res.status === 429) { const wait = Number(res.headers.get("retry-after") ?? 15) * 1000 + 1000; console.error(`[rate-limited] waiting ${Math.round(wait / 1000)}s`); await sleep(wait); continue; }
    const text = await res.text();
    if (!res.ok) { console.error(`[WARN] ${path.split("?")[0]} ${res.status}: ${text.slice(0, 200)}`); return null; }
    try { return JSON.parse(text); } catch { return null; }
  }
  return null;
};
const GCH = { Authorization: `Bearer ${env.GOCARDLESS_API_TOKEN}`, "GoCardless-Version": "2015-07-06", Accept: "application/json" };
const gcBase = (env.GOCARDLESS_ENVIRONMENT ?? "live") === "sandbox" ? "https://api-sandbox.gocardless.com" : "https://api.gocardless.com";
const gcGet = async (path) => {
  const res = await fetch(`${gcBase}/${path}`, { headers: GCH });
  const text = await res.text();
  if (!res.ok) { console.error(`[WARN] GC ${path.split("?")[0]} ${res.status}: ${text.slice(0, 200)}`); return null; }
  return JSON.parse(text);
};
const money = (n) => (n ?? 0).toLocaleString("en-AU", { style: "currency", currency: "AUD" });
const FROM = "2026-07-01";
const TODAY = new Date().toISOString().slice(0, 10);

// ---- 1. Xero: 602 statement lines since FROM ----
const accts = await xeroGet("Accounts?where=Type%3D%3D%22BANK%22");
const a602 = (accts?.Accounts ?? []).find((a) => a.Code === "602");
if (!a602) { console.error("no 602 bank account"); process.exit(1); }
console.log(`Xero account: ${a602.Code} ${a602.Name}\n`);
const lines = [];
for (let start = new Date(FROM); start <= new Date(TODAY); ) {
  const end = new Date(Math.min(start.getTime() + 29 * 86400000, new Date(TODAY).getTime()));
  const f = start.toISOString().slice(0, 10), t = end.toISOString().slice(0, 10);
  const rep = await xeroGet(`Reports/BankStatement?bankAccountID=${a602.AccountID}&fromDate=${f}&toDate=${t}`);
  const report = rep?.Reports?.[0];
  if (report) {
    const header = (report.Rows ?? []).find((r) => r.RowType === "Header");
    const cols = (header?.Cells ?? []).map((c) => c.Value);
    const ix = (name) => cols.findIndex((c) => String(c).toLowerCase() === name);
    const iDate = ix("date"), iDesc = ix("description"), iRef = ix("reference"), iRec = ix("reconciled"), iSrc = ix("source"), iAmt = ix("amount");
    for (const sec of (report.Rows ?? []).filter((r) => r.RowType === "Section")) {
      for (const row of sec.Rows ?? []) {
        if (row.RowType !== "Row") continue;
        const c = row.Cells ?? [];
        const desc = String(c[iDesc]?.Value ?? "");
        if (/^(opening|closing) balance/i.test(desc)) continue;
        lines.push({ date: String(c[iDate]?.Value ?? "").slice(0, 10), desc, ref: String(c[iRef]?.Value ?? ""), reconciled: String(c[iRec]?.Value ?? ""), source: String(c[iSrc]?.Value ?? ""), amount: Number(c[iAmt]?.Value ?? 0) });
      }
    }
  }
  start = new Date(end.getTime() + 86400000);
}
const unrec = lines.filter((l) => /^no$/i.test(l.reconciled));
const isGc = (l) => /gocardless|go cardless|\bGC\b/i.test(`${l.desc} ${l.ref}`);
const gcLines = lines.filter(isGc);
console.log(`Statement lines ${FROM}..${TODAY}: ${lines.length} total, ${unrec.length} unreconciled`);
console.log(`GoCardless-looking lines: ${gcLines.length} total, ${gcLines.filter((l) => /^no$/i.test(l.reconciled)).length} unreconciled`);
console.log("\nDistinct descriptions of unreconciled RECEIPT lines (top 15):");
const byDesc = new Map();
for (const l of unrec.filter((l) => l.amount > 0)) { const k = l.desc.replace(/\d{4,}/g, "#").slice(0, 40); byDesc.set(k, (byDesc.get(k) ?? 0) + 1); }
for (const [k, n] of [...byDesc.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15)) console.log(`  ${String(n).padStart(3)}  ${k}`);
console.log("\nUnreconciled GoCardless lines in the feed:");
for (const l of gcLines.filter((l) => /^no$/i.test(l.reconciled)).sort((a, b) => a.date.localeCompare(b.date))) console.log(`  ${l.date}  ${money(l.amount).padStart(12)}  ${l.desc.slice(0, 50)}  [${l.source}]`);

// ---- 2. GoCardless payouts over the window ----
const po = await gcGet(`payouts?limit=500&created_at%5Bgte%5D=${FROM}T00:00:00Z`);
const payouts = (po?.payouts ?? []).sort((a, b) => a.arrival_date.localeCompare(b.arrival_date));
console.log(`\nGoCardless payouts since ${FROM}: ${payouts.length}`);
const near = (d1, d2, days) => Math.abs(new Date(d1) - new Date(d2)) <= days * 86400000;
const rows = [];
for (const p of payouts) {
  const net = p.amount / 100, fees = (p.deducted_fees ?? 0) / 100;
  const match = gcLines.find((l) => Math.abs(l.amount - net) < 0.011 && near(l.date, p.arrival_date, 4))
    ?? lines.find((l) => l.amount > 0 && Math.abs(l.amount - net) < 0.011 && near(l.date, p.arrival_date, 4));
  rows.push({ id: p.id, arrival: p.arrival_date, net, fees, gross: net + fees, status: p.status, feed: match ? (/^no$/i.test(match.reconciled) ? "UNRECONCILED" : "reconciled") : "not in feed", feedDate: match?.date ?? "" });
}
console.log("  arrival     net          fees      status     feed line");
for (const r of rows) console.log(`  ${r.arrival}  ${money(r.net).padStart(12)}  ${money(r.fees).padStart(8)}  ${r.status.padEnd(9)}  ${r.feed}${r.feedDate ? ` (${r.feedDate})` : ""}`);
const unrecPayouts = rows.filter((r) => r.feed === "UNRECONCILED");
console.log(`\nPayouts sitting unreconciled in Xero: ${unrecPayouts.length} (${money(unrecPayouts.reduce((s, r) => s + r.net, 0))} net) · not in feed yet: ${rows.filter((r) => r.feed === "not in feed").length}`);

// ---- 3. Mapping check on the first two unreconciled payouts ----
const { data: linkSample } = await supabase.from("recurring_plan_gc_subscriptions").select("*").limit(1);
const linkCols = Object.keys(linkSample?.[0] ?? {});
const planFk = linkCols.find((c) => /plan_id$/.test(c)) ?? "recurring_plan_id";
const { data: planSample } = await supabase.from("recurring_plans").select("*").limit(1);
const planCols = Object.keys(planSample?.[0] ?? {});
const nameCol = ["customer_name", "site_name", "name", "title"].find((c) => planCols.includes(c));
const custFk = ["customer_id", "site_id"].find((c) => planCols.includes(c));
console.log(`\nCRM link table cols: ${linkCols.join(", ")}\nplan cols of interest: ${[nameCol, custFk, "xero_repeating_invoice_id", "gc_subscription_id"].filter(Boolean).join(", ")}`);
const out = { probedAt: new Date().toISOString(), payouts: rows, mapping: [] };
const N = Number(process.env.PROBE_PAYOUTS ?? 2);
const probeSet = unrecPayouts.length ? unrecPayouts.slice(0, N) : rows.slice(-N);
if (!unrecPayouts.length) console.log("\n(no unreconciled payouts visible - mapping the two most recent instead)");
for (const r of probeSet) {
  const items = (await gcGet(`payout_items?payout=${r.id}&limit=500`))?.payout_items ?? [];
  const byType = {};
  for (const it of items) byType[it.type] = (byType[it.type] ?? 0) + Number(it.amount) / 100;
  console.log(`\nPayout ${r.id} (${r.arrival}) net ${money(r.net)} — ${items.length} items: ${Object.entries(byType).map(([k, v]) => `${k} ${money(v)}`).join(", ")}`);
  const payItems = items.filter((it) => it.type === "payment_paid_out" && it.links?.payment);
  for (const it of payItems) {
    const pay = (await gcGet(`payments/${it.links.payment}`))?.payments;
    const subId = pay?.links?.subscription ?? null;
    let plan = null, link = null;
    if (subId) {
      const { data: l } = await supabase.from("recurring_plan_gc_subscriptions").select("*").eq("gc_subscription_id", subId).maybeSingle();
      link = l;
      if (l?.[planFk]) { const { data: p } = await supabase.from("recurring_plans").select("*").eq("id", l[planFk]).maybeSingle(); plan = p; }
    }
    let who = plan?.[nameCol] ?? null;
    let xeroContactId = plan?.xero_contact_id ?? null;
    if (plan?.site_id) {
      // site-first: the billing contact lives on the site (customer_sites.xero_contact_id)
      const { data: site } = await supabase.from("customer_sites").select("name, xero_contact_id").eq("id", plan.site_id).maybeSingle();
      who = who ?? site?.name ?? null;
      xeroContactId = xeroContactId ?? site?.xero_contact_id ?? null;
    }
    if (plan?.customer_id) {
      const { data: cust } = await supabase.from("customers").select("name, xero_contact_id").eq("id", plan.customer_id).maybeSingle();
      who = who ?? cust?.name ?? null;
      xeroContactId = xeroContactId ?? cust?.xero_contact_id ?? null;
    }
    if (!link && pay?.links?.mandate) {
      const m = (await gcGet(`mandates/${pay.links.mandate}`))?.mandates;
      const gcCustomerId = m?.links?.customer ?? null;
      // fallback: the plan that owns this GC customer (recurring_plans.gc_customer_id / gc_mandate_id)
      if (gcCustomerId) {
        const { data: byCust } = await supabase.from("recurring_plans").select("*").or(`gc_customer_id.eq.${gcCustomerId},gc_mandate_id.eq.${pay.links.mandate}`).eq("status", "active").limit(2);
        if (byCust?.length === 1) { plan = byCust[0]; link = { [planFk]: plan.id, via: "gc_customer" }; }
      }
      const gcc = gcCustomerId ? (await gcGet(`customers/${gcCustomerId}`))?.customers : null;
      const gcName = gcc ? (gcc.company_name ?? `${gcc.given_name ?? ""} ${gcc.family_name ?? ""}`.trim()) : null;
      if (!link && gcc) who = `GC: ${gcName} <${gcc.email ?? ""}>`;
      else if (link && !who && gcName) who = gcName; // plan found via GC customer but carries no site/customer name — use GC's
    }
    let invNote = "no contact";
    let contactVia = "stored";
    if (!xeroContactId && who && !who.startsWith("GC:")) {
      // fallback: find the Xero contact by name (strip the franchise prefix, search the distinctive part)
      const needle = who.replace(/^snap fitness\s+/i, "").replace(/[^a-z0-9 ]/gi, "").trim().split(/\s+/).slice(0, 2).join(" ");
      const found = (await xeroGet(`Contacts?where=${encodeURIComponent(`Name.Contains("${needle}")`)}`))?.Contacts ?? [];
      const clean = found.filter((c) => !/^PAYMENT FROM/i.test(c.Name) && c.ContactStatus !== "ARCHIVED");
      const exact = clean.find((c) => c.Name.trim().toLowerCase() === who.trim().toLowerCase()) ?? (clean.length === 1 ? clean[0] : null);
      if (exact) { xeroContactId = exact.ContactID; contactVia = `name→"${exact.Name}"`; }
      else if (found.length > 1) invNote = `contact ambiguous (${found.length}): ${found.slice(0, 3).map((c) => c.Name).join(" | ")}`;
      else invNote = `no contact named "${needle}"`;
    }
    if (xeroContactId && pay?.charge_date) {
      const cents = Number(it.amount);
      const d = new Date(pay.charge_date);
      const lo = new Date(d.getTime() - 14 * 86400000).toISOString().slice(0, 10), hi = new Date(d.getTime() + 14 * 86400000).toISOString().slice(0, 10);
      const where = encodeURIComponent(`Contact.ContactID==Guid("${xeroContactId}") AND Type=="ACCREC" AND Date>=DateTime(${lo.replace(/-/g, ",")}) AND Date<=DateTime(${hi.replace(/-/g, ",")})`);
      const inv = (await xeroGet(`Invoices?where=${where}&order=Date`))?.Invoices ?? [];
      const hits = inv.filter((i) => Math.round(Number(i.Total) * 100) === cents && !["VOIDED", "DELETED", "DRAFT"].includes(i.Status));
      if (hits.length === 1) invNote = `invoice ${hits[0].InvoiceNumber} ${hits[0].Status}${hits[0].Status === "PAID" ? " (already paid)" : ` due ${money(hits[0].AmountDue)}`}`;
      else if (hits.length > 1) invNote = `AMBIGUOUS ${hits.length} invoices: ${hits.map((i) => `${i.InvoiceNumber}/${i.Status}`).join(" ")}`;
      else {
        // second fallback: any invoice of this exact amount in the window, whoever the contact is
        const any = (await xeroGet(`Invoices?where=${encodeURIComponent(`Type=="ACCREC" AND Total==${(cents / 100).toFixed(2)} AND Date>=DateTime(${lo.replace(/-/g, ",")}) AND Date<=DateTime(${hi.replace(/-/g, ",")})`)}`))?.Invoices ?? [];
        const live = any.filter((i) => !["VOIDED", "DELETED", "DRAFT", "PAID"].includes(i.Status));
        invNote = live.length ? `NO INVOICE under this contact; same amount exists for: ${live.slice(0, 3).map((i) => `${i.Contact?.Name} ${i.InvoiceNumber}`).join(" | ")}` : `NO INVOICE anywhere for ${money(cents / 100)} in window`;
      }
      if (contactVia !== "stored" && !invNote.startsWith("NO INVOICE") && !invNote.startsWith("AMBIG")) invNote += ` [contact ${contactVia}]`;
    }
    if (!who && plan?.[custFk]) {
      const { data: c } = await supabase.from(custFk === "site_id" ? "sites" : "customers").select("name").eq("id", plan[custFk]).maybeSingle();
      who = c?.name ?? null;
    }
    const line = `  ${money(Number(it.amount) / 100).padStart(10)}  ${pay?.charge_date ?? "?"}  ${(link ? (who ?? "?") : `NO CRM LINK ${who ?? ""}`).slice(0, 44).padEnd(44)}  ${invNote}`;
    console.log(line);
    out.mapping.push({ payout: r.id, payment: it.links.payment, amount_cents: Number(it.amount), charge_date: pay?.charge_date, subscription: subId, plan: link?.[planFk] ?? null, who, xeroContactId, riLinked: !!plan?.xero_repeating_invoice_id, invoice: invNote });
  }
  if (items.filter((it) => it.type === "payment_paid_out").length > payItems.length) console.log(`  … ${items.filter((it) => it.type === "payment_paid_out").length - payItems.length} more payments in this payout`);
}
const bucket = (m) => m.invoice.startsWith("invoice ") ? "clean" : m.invoice.startsWith("AMBIG") ? "ambiguous invoice" : m.invoice.startsWith("contact ambiguous") ? "contact ambiguous" : m.invoice.startsWith("no contact named") ? "no contact by name" : m.invoice.startsWith("NO INVOICE under") ? "wrong contact / invoice elsewhere" : m.invoice.startsWith("NO INVOICE anywhere") ? "no invoice at all" : !m.plan ? "no CRM link" : "no contact";
const counts = {};
for (const m of out.mapping) { const b = bucket(m); counts[b] = (counts[b] ?? 0) + 1; }
console.log(`
SUMMARY over ${probeSet.length} payouts, ${out.mapping.length} payments:`);
for (const [k, v] of Object.entries(counts).sort((a, b) => b[1] - a[1])) console.log(`  ${String(v).padStart(3)}  ${k}`);
const fixOnce = new Map();
for (const m of out.mapping) { const b = bucket(m); if (b === "clean") continue; const key = `${b}|${m.who ?? m.subscription}`; if (!fixOnce.has(key)) fixOnce.set(key, { bucket: b, who: m.who, subscription: m.subscription, example: m.invoice.slice(0, 110), payments: 0, cents: 0 }); const f = fixOnce.get(key); f.payments += 1; f.cents += m.amount_cents; }
console.log(`
LINK-ONCE WORKSHEET (${fixOnce.size} distinct items):`);
for (const f of [...fixOnce.values()].sort((a, b) => a.bucket.localeCompare(b.bucket))) console.log(`  [${f.bucket}] ${(f.who ?? f.subscription ?? "?").slice(0, 46).padEnd(46)} ${String(f.payments).padStart(2)} pmts ${money(f.cents / 100).padStart(10)}  ${f.example}`);
out.summary = counts; out.fixOnce = [...fixOnce.values()];
writeFileSync(new URL("./gc-payout-recon-probe.json", import.meta.url), JSON.stringify(out, null, 2));
console.log("\nwrote scripts/gc-payout-recon-probe.json");
