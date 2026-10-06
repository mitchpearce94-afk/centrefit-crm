// WRITES with --post. Mitchell 6 Oct: create 478 + 625, code + approve the Staff X bills, and approve every other DRAFT bill except "No Contact" ones.
// Codes come from 12-month supplier history (scripts/xero-supplier-coding.json) with overrides below. Unknown suppliers are skipped and listed.
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
const POST = process.argv.includes("--post");
const env = Object.fromEntries(readFileSync(new URL("../.env.gc-probe", import.meta.url), "utf8").split("\n").filter((l) => l.includes("=") && !l.startsWith("#")).map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, "").replace(/\\n$/, "")]; }));
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const { data: conn } = await sb.from("xero_connections").select("id, tenant_id, access_token, refresh_token, expires_at").order("updated_at", { ascending: false }).limit(1).single();
let at = conn.access_token;
if (!conn.expires_at || new Date(conn.expires_at).getTime() < Date.now() + 120_000) {
  const res = await fetch("https://identity.xero.com/connect/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", Authorization: "Basic " + Buffer.from(`${env.XERO_CLIENT_ID}:${env.XERO_CLIENT_SECRET}`).toString("base64") }, body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: conn.refresh_token }) });
  const tok = await res.json(); if (!res.ok) { console.error("refresh failed", JSON.stringify(tok)); process.exit(1); }
  at = tok.access_token; await sb.from("xero_connections").update({ access_token: tok.access_token, refresh_token: tok.refresh_token ?? conn.refresh_token, expires_at: new Date(Date.now() + (tok.expires_in ?? 1800) * 1000).toISOString(), updated_at: new Date().toISOString() }).eq("id", conn.id);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms)); let calls = 0;
const xero = async (m, p, b, attempt = 0) => { await sleep(1100); calls++; const r = await fetch("https://api.xero.com/api.xro/2.0/" + p, { method: m, headers: { Authorization: `Bearer ${at}`, "Xero-tenant-id": conn.tenant_id, Accept: "application/json", "Content-Type": "application/json" }, body: b ? JSON.stringify(b) : undefined }); const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch {} if (r.status === 429 && attempt < 3) { await sleep(61000); return xero(m, p, b, attempt + 1); } if (!r.ok) throw new Error(`${m} ${p} ${r.status}: ${(j?.Elements?.[0]?.ValidationErrors?.map((e) => e.Message).join("; ") || t).slice(0, 300)}`); return j; };

// 1. accounts
const NEW_ACCOUNTS = [
  { Code: "480", Name: "Contractors - Outsourced Staff (Staff X)", Type: "EXPENSE", TaxType: "INPUT", Description: "Offshore staff supplied by Staff X Global (salary + mandated benefits + service fee). Not wages — Staff X is the employer." },
  { Code: "625", Name: "Deposits Paid (Bonds)", Type: "CURRENT", TaxType: "BASEXCLUDED", Description: "Refundable security deposits / bonds Centrefit has paid to suppliers (e.g. Staff X Global)." },
];
for (const a of NEW_ACCOUNTS) { const j = await xero("GET", `Accounts?where=${encodeURIComponent(`Code=="${a.Code}"`)}`); if (j.Accounts?.length) { console.log(`account ${a.Code} exists: ${j.Accounts[0].Name}`); continue; } if (!POST) { console.log(`would create account ${a.Code} ${a.Name}`); continue; } await xero("PUT", "Accounts", a); console.log(`created account ${a.Code} ${a.Name}`); }

// 2. coding rules: contact regex → { code, tax, perLine? }
const rules = [
  { re: /^Staff X Global/i, pick: (inv) => /Security Deposit/i.test(inv.LineItems.map((l) => l.Description).join(" ")) ? { code: "625", tax: "BASEXCLUDED" } : { code: "480", tax: "INPUT" } },
  { re: /^Power Drive Electrical/i, code: "345", tax: "INPUT" },
  { re: /^Premier Power Solutions/i, code: "345", tax: "INPUT" },
  { re: /^Jaycar/i, code: "341", tax: "INPUT" },
  { re: /^Seadan/i, code: "341", tax: "INPUT" },
  { re: /^DJ City/i, code: "341", tax: "INPUT" },
  { re: /^Origin/i, code: "445", tax: "INPUT" },
  { re: /^Telstra/i, code: "489", tax: "INPUT" },
  { re: /^Safe Qld/i, code: "470", tax: "INPUT" },
  { re: /^Bunnings/i, code: "341", tax: "INPUT" },
  { re: /^Uber/i, code: "493", tax: "INPUT" },
  { re: /^MYOB/i, code: "485", tax: "INPUT" },
];
const hist = JSON.parse(readFileSync(new URL("./xero-supplier-coding.json", import.meta.url), "utf8")).suppliers;

// 3. live drafts
const draftList = (await xero("GET", `Invoices?where=${encodeURIComponent('Type=="ACCPAY" AND Status=="DRAFT"')}`)).Invoices;
const drafts = []; for (const d of draftList) drafts.push((await xero("GET", `Invoices/${d.InvoiceID}`)).Invoices[0]);
console.log(`\n${POST ? "POSTING" : "DRY RUN"} — ${drafts.length} draft bills\n`);
let approved = 0, skipped = 0, deleted = 0, failed = 0;
for (const inv of drafts) {
  const who = inv.Contact?.Name || "(none)"; const label = `${inv.DateString?.slice(0, 10)} ${who} ${inv.InvoiceNumber || ""} $${inv.Total}`;
  if (/^No Contact$/i.test(who) || !inv.Contact?.ContactID) { skipped++; console.log(`  skip (No Contact)   ${label}`); continue; }
  if (Number(inv.Total) === 0) { if (POST) { try { await xero("POST", `Invoices/${inv.InvoiceID}`, { Invoices: [{ InvoiceID: inv.InvoiceID, Status: "DELETED" }] }); } catch (e) { failed++; console.log(`  ✗ delete $0 ${label} → ${e.message}`); continue; } } deleted++; console.log(`  ${POST ? "deleted" : "would delete"} $0 bill  ${label}`); continue; }
  const rule = rules.find((r) => r.re.test(who)); let coding = rule ? (rule.pick ? rule.pick(inv) : { code: rule.code, tax: rule.tax }) : null;
  if (!coding) { const h = hist[who]; if (h && h.share >= 0.8 && h.bills >= 3) coding = { code: h.code, tax: h.tax || "INPUT", fromHistory: true }; }
  if (!coding) { skipped++; console.log(`  skip (no rule)      ${label} — lines currently ${inv.LineItems.map((l) => l.AccountCode || "?").join(",")}`); continue; }
  const lines = inv.LineItems.filter((l) => Number(l.LineAmount) !== 0 || Number(l.UnitAmount) !== 0).map((l) => ({ ...l, Description: l.Description || `${who} ${inv.InvoiceNumber || ""}`.trim(), AccountCode: coding.code, TaxType: coding.tax }));
  if (!POST) { approved++; console.log(`  would approve       ${label} → ${coding.code} ${coding.tax}${coding.fromHistory ? " (history)" : ""}`); continue; }
  try { await xero("POST", `Invoices/${inv.InvoiceID}`, { Invoices: [{ InvoiceID: inv.InvoiceID, Status: "AUTHORISED", LineItems: lines }] }); approved++; console.log(`  ✓ approved          ${label} → ${coding.code} ${coding.tax}`); }
  catch (e) { failed++; console.log(`  ✗ ${label} → ${e.message}`); }
}
console.log(`\n${POST ? "posted" : "dry run"}: approved ${approved}, deleted ${deleted}, skipped ${skipped}, failed ${failed}, calls ${calls}`);
if (POST) await sb.from("finance_agent_actions").insert({ actor: "cortex", action: "bills.approve_drafts", entity: "xero", entity_id: "ACCPAY", after: { approved, deleted, skipped, failed }, rule: "Mitchell 6 Oct: approve all drafts except No Contact; Staff X → 480 / deposit → 625", note: "approve-drafts-2026-10-06.mjs" });
