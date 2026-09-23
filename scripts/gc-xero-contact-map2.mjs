// 2026-09-23 — READ-ONLY. The cleanup worksheet Mitchell asked for: every
// GoCardless customer with a live mandate ↔ the CRM plan(s) that bill it ↔ the
// Xero contact that should carry its invoices. Goal: one GC customer, one Xero
// contact, matched by ID in the CRM (name equality is for humans, the ID is
// for the agent). Writes scripts/gc-xero-contact-map2.csv + .json, changes nothing.
// Run: node scripts/gc-xero-contact-map.mjs
import { readFileSync, existsSync, writeFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const envFile = ["../.env.gc-probe", "../.env.local"].map((p) => new URL(p, import.meta.url)).find((u) => existsSync(u));
const env = Object.fromEntries(readFileSync(envFile, "utf8").split("\n").filter((l) => l.includes("=") && !l.startsWith("#")).map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, "").replace(/\\r|\\n/g, "").trim()]; }));
const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

// ---- Xero auth ----
const { data: conn } = await supabase.from("xero_connections").select("id, tenant_id, access_token, refresh_token, expires_at").order("updated_at", { ascending: false }).limit(1).single();
let accessToken = conn.access_token;
if (!conn.expires_at || new Date(conn.expires_at).getTime() < Date.now() + 60_000) {
  const res = await fetch("https://identity.xero.com/connect/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", Authorization: "Basic " + Buffer.from(`${env.XERO_CLIENT_ID}:${env.XERO_CLIENT_SECRET}`).toString("base64") }, body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: conn.refresh_token }) });
  const tok = await res.json();
  if (!res.ok) { console.error("Token refresh failed:", JSON.stringify(tok)); process.exit(1); }
  accessToken = tok.access_token;
  await supabase.from("xero_connections").update({ access_token: tok.access_token, refresh_token: tok.refresh_token ?? conn.refresh_token, expires_at: new Date(Date.now() + (tok.expires_in ?? 1800) * 1000).toISOString(), updated_at: new Date().toISOString() }).eq("id", conn.id);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const xeroGet = async (path) => {
  for (let attempt = 1; attempt <= 5; attempt++) {
    const res = await fetch(`https://api.xero.com/api.xro/2.0/${path}`, { headers: { Authorization: `Bearer ${accessToken}`, "Xero-tenant-id": conn.tenant_id, Accept: "application/json" } });
    if (res.status === 429) { const wait = Number(res.headers.get("retry-after") ?? 15) * 1000 + 1000; console.error(`[rate-limited] waiting ${Math.round(wait / 1000)}s`); await sleep(wait); continue; }
    const text = await res.text();
    if (!res.ok) { console.error(`[WARN] ${path.split("?")[0]} ${res.status}: ${text.slice(0, 160)}`); return null; }
    try { return JSON.parse(text); } catch { return null; }
  }
  return null;
};
const GCH = { Authorization: `Bearer ${env.GOCARDLESS_API_TOKEN}`, "GoCardless-Version": "2015-07-06", Accept: "application/json" };
const gcBase = (env.GOCARDLESS_ENVIRONMENT ?? "live") === "sandbox" ? "https://api-sandbox.gocardless.com" : "https://api.gocardless.com";
const gcList = async (resource, params = "") => {
  const all = []; let after = "";
  for (;;) {
    const res = await fetch(`${gcBase}/${resource}?limit=500${params}${after ? `&after=${after}` : ""}`, { headers: GCH });
    const body = await res.json();
    if (!res.ok) { console.error(`[WARN] GC ${resource} ${res.status}: ${JSON.stringify(body).slice(0, 160)}`); break; }
    all.push(...(body[resource] ?? []));
    after = body.meta?.cursors?.after; if (!after) break;
  }
  return all;
};
const norm = (s) => String(s ?? "").toLowerCase().replace(/pty\.? ?ltd\.?/g, "").replace(/\bt\/a\b/g, "").replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
const gcName = (c) => (c.company_name ?? `${c.given_name ?? ""} ${c.family_name ?? ""}`).trim();

// ---- GoCardless: customers that still have an active mandate ----
const mandates = await gcList("mandates", "&status=active");
const subsAll = await gcList("subscriptions", "&status=active");
const mandateByCustomer = new Map();
for (const m of mandates) { const c = m.links?.customer; if (!c) continue; if (!mandateByCustomer.has(c)) mandateByCustomer.set(c, []); mandateByCustomer.get(c).push(m); }
const subsByMandate = new Map();
for (const s of subsAll) { const m = s.links?.mandate; if (!subsByMandate.has(m)) subsByMandate.set(m, []); subsByMandate.get(m).push(s); }
const customers = await gcList("customers");
const gcCustomers = customers.filter((c) => mandateByCustomer.has(c.id));
console.log(`GoCardless: ${customers.length} customers, ${gcCustomers.length} with an active mandate, ${subsAll.length} active subscriptions`);

// ---- CRM ----
const { data: plans } = await supabase.from("recurring_plans").select("id, status, source, customer_id, site_id, gc_customer_id, gc_mandate_id, gc_subscription_id, xero_contact_id, xero_repeating_invoice_id");
const { data: links } = await supabase.from("recurring_plan_gc_subscriptions").select("plan_id, gc_subscription_id, gc_status");
const { data: sites } = await supabase.from("customer_sites").select("id, name, customer_id, xero_contact_id");
const { data: crmCustomers } = await supabase.from("customers").select("id, name, xero_contact_id");
const siteById = new Map((sites ?? []).map((s) => [s.id, s]));
const custById = new Map((crmCustomers ?? []).map((c) => [c.id, c]));
const planById = new Map((plans ?? []).map((p) => [p.id, p]));
const plansBySub = new Map();
for (const l of links ?? []) { if (!plansBySub.has(l.gc_subscription_id)) plansBySub.set(l.gc_subscription_id, new Set()); plansBySub.get(l.gc_subscription_id).add(l.plan_id); }
for (const p of plans ?? []) { for (const s of [p.gc_subscription_id]) if (s) { if (!plansBySub.has(s)) plansBySub.set(s, new Set()); plansBySub.get(s).add(p.id); } }

// ---- Xero: all contacts once ----
const xeroContacts = [];
for (let page = 1; page < 40; page++) {
  const r = await xeroGet(`Contacts?page=${page}&includeArchived=true`);
  const batch = r?.Contacts ?? [];
  xeroContacts.push(...batch);
  if (batch.length < 100) break;
}
const contactById = new Map(xeroContacts.map((c) => [c.ContactID, c]));
const isJunk = (c) => /^PAYMENT FROM/i.test(c.Name) || c.ContactStatus === "ARCHIVED";
console.log(`Xero: ${xeroContacts.length} contacts (${xeroContacts.filter(isJunk).length} archived or "PAYMENT FROM" junk)`);

// ---- Build the worksheet ----
const rows = [];
for (const c of gcCustomers) {
  const mands = mandateByCustomer.get(c.id) ?? [];
  const subs = mands.flatMap((m) => subsByMandate.get(m.id) ?? []);
  const planIds = new Set();
  for (const s of subs) for (const pid of plansBySub.get(s.id) ?? []) planIds.add(pid);
  for (const p of plans ?? []) if (p.gc_customer_id === c.id || mands.some((m) => m.id === p.gc_mandate_id)) planIds.add(p.id);
  const planRows = [...planIds].map((id) => planById.get(id)).filter(Boolean);
  const activePlans = planRows.filter((p) => p.status === "active");
  const site = activePlans.map((p) => siteById.get(p.site_id)).find(Boolean) ?? planRows.map((p) => siteById.get(p.site_id)).find(Boolean);
  const crmCust = activePlans.map((p) => custById.get(p.customer_id)).find(Boolean) ?? planRows.map((p) => custById.get(p.customer_id)).find(Boolean);
  const storedId = activePlans.map((p) => p.xero_contact_id).find(Boolean) ?? site?.xero_contact_id ?? crmCust?.xero_contact_id ?? null;
  const stored = storedId ? contactById.get(storedId) : null;
  const name = gcName(c);
  const exact = xeroContacts.filter((x) => !isJunk(x) && norm(x.Name) === norm(name));
  const siteExact = site ? xeroContacts.filter((x) => !isJunk(x) && norm(x.Name) === norm(site.name)) : [];
  const fuzzy = xeroContacts.filter((x) => !isJunk(x) && (norm(x.Name).includes(norm(name).replace(/^snap fitness /, "")) || (site && norm(x.Name).includes(norm(site.name).replace(/^snap fitness /, ""))))).slice(0, 4);
  let status, proposed = null;
  if (stored && !isJunk(stored) && norm(stored.Name) === norm(name)) { status = "OK — stored + names equal"; proposed = stored; }
  else if (stored && !isJunk(stored)) { status = "stored, names differ"; proposed = stored; }
  else if (exact.length === 1) { status = "no stored id — exact name match"; proposed = exact[0]; }
  else if (siteExact.length === 1) { status = "no stored id — site name match"; proposed = siteExact[0]; }
  else if (exact.length > 1 || siteExact.length > 1) status = "AMBIGUOUS — several Xero contacts with this name";
  else if (fuzzy.length) status = "no match — candidates by fragment";
  else status = "NO XERO CONTACT";
  if (!planRows.length) status = `NO CRM PLAN · ${status}`;
  rows.push({
    gc_customer_id: c.id, gc_name: name, gc_email: c.email ?? "", gc_subs: subs.length, gc_monthly_cents: subs.filter((s) => s.interval_unit === "monthly").reduce((t, s) => t + s.amount, 0),
    crm_plans: planRows.length, crm_active_plans: activePlans.length, crm_site: site?.name ?? "", crm_customer: crmCust?.name ?? "",
    stored_xero_contact: stored ? stored.Name : storedId ? `(id not in Xero: ${storedId.slice(0, 8)})` : "",
    proposed_xero_contact: proposed?.Name ?? "", proposed_xero_contact_id: proposed?.ContactID ?? "",
    candidates: (exact.length > 1 ? exact : siteExact.length > 1 ? siteExact : fuzzy).map((x) => x.Name).join(" | "),
    status,
  });
}

// ---- Enrichment: which candidate contact actually carries this site's invoices since 20 Jun? ----
const invCache = new Map();
const invoicesFor = async (contactId) => {
  if (invCache.has(contactId)) return invCache.get(contactId);
  const inv = (await xeroGet(`Invoices?where=${encodeURIComponent(`Contact.ContactID==Guid("${contactId}") AND Type=="ACCREC" AND Date>=DateTime(2026,06,20)`)}&order=Date`))?.Invoices ?? [];
  const live = inv.filter((i) => !["VOIDED", "DELETED", "DRAFT"].includes(i.Status));
  const v = { n: live.length, total: live.reduce((t, i) => t + Number(i.Total), 0), last: live.length ? String(live.at(-1).DateString ?? "").slice(0, 10) : "", amounts: [...new Set(live.map((i) => Number(i.Total).toFixed(2)))].slice(0, 5) };
  invCache.set(contactId, v); return v;
};
const frag = (s) => norm(s).replace(/^snap fitness /, "").replace(/^planet fitness /, "").split(" ").filter((w) => w.length > 3).slice(0, 2).join(" ");
for (const r of rows) {
  const cands = new Map();
  const add = (x) => { if (x && !isJunk(x)) cands.set(x.ContactID, x); };
  if (r.proposed_xero_contact_id) add(contactById.get(r.proposed_xero_contact_id));
  for (const needle of [frag(r.gc_name), r.crm_site ? frag(r.crm_site) : ""].filter(Boolean)) {
    for (const x of xeroContacts) if (!isJunk(x) && needle && norm(x.Name).includes(needle)) add(x);
  }
  const st = (plans ?? []).filter((p) => p.gc_customer_id === r.gc_customer_id).map((p) => p.xero_contact_id).find(Boolean);
  if (st) add(contactById.get(st));
  const scored = [];
  for (const x of [...cands.values()].slice(0, 6)) { const v = await invoicesFor(x.ContactID); scored.push({ x, v }); }
  scored.sort((a, b) => (b.v.last || "").localeCompare(a.v.last || "") || b.v.n - a.v.n);
  const carrier = scored.find((s) => s.v.n > 0) ?? null;
  r.candidates_with_invoices = scored.map((s) => `${s.x.Name} [${s.v.n} inv${s.v.n ? ` ${money(s.v.total)} last ${s.v.last} · ${s.v.amounts.join("/")}` : ""}]`).join(" | ");
  r.canonical_xero_contact = carrier?.x.Name ?? "";
  r.canonical_xero_contact_id = carrier?.x.ContactID ?? "";
  r.canonical_matches_stored = carrier ? (r.stored_xero_contact === carrier.x.Name) : false;
  r.gc_monthly = money(r.gc_monthly_cents / 100);
  const carriers = scored.filter((s) => s.v.n > 0).length;
  r.decision = !carrier ? "NO-CARRIER" : carriers > 1 ? "SPLIT" : r.canonical_matches_stored ? "ok" : r.stored_xero_contact ? "RE-POINT" : "KEY";
}

rows.sort((a, b) => a.status.localeCompare(b.status) || a.gc_name.localeCompare(b.gc_name));
const counts = {};
for (const r of rows) counts[r.status] = (counts[r.status] ?? 0) + 1;
console.log("\nSTATUS SUMMARY:");
for (const [k, v] of Object.entries(counts).sort((a, b) => b[1] - a[1])) console.log(`  ${String(v).padStart(3)}  ${k}`);
const dcounts = {};
for (const r of rows) dcounts[r.decision] = (dcounts[r.decision] ?? 0) + 1;
console.log("\nDECISIONS:", JSON.stringify(dcounts));
for (const r of rows.filter((r) => r.decision !== "ok").sort((a, b) => a.decision.localeCompare(b.decision) || a.gc_name.localeCompare(b.gc_name)))
  console.log(`\n[${r.decision}] GC "${r.gc_name}" (${r.gc_subs} subs, ${r.gc_monthly}/mo) · CRM site "${r.crm_site}" · stored "${r.stored_xero_contact}"\n    candidates: ${r.candidates_with_invoices || "none"}`);
const csvEsc = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
const cols = Object.keys(rows[0] ?? {});
writeFileSync(new URL("./gc-xero-contact-map2.csv", import.meta.url), [cols.join(","), ...rows.map((r) => cols.map((c) => csvEsc(r[c])).join(","))].join("\n"));
writeFileSync(new URL("./gc-xero-contact-map2.json", import.meta.url), JSON.stringify({ generatedAt: new Date().toISOString(), counts, rows }, null, 2));
console.log(`\nwrote scripts/gc-xero-contact-map2.csv (${rows.length} rows) + .json`);
