// Billing reconciliation: everything Centrefit PAYS for (Kinetix NBN, M2M
// SIMs, Sentinel monitoring — from Mitchell's Direct Debiting 240426.xlsx)
// vs everything Centrefit BILLS (CRM recurring plans + authorised Xero
// repeating invoices). Read-only. Outputs scripts/recon-report.md.
import { readFileSync, writeFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const env = Object.fromEntries(
  readFileSync(new URL("../.env.gc-probe", import.meta.url), "utf8")
    .split("\n").filter((l) => l.includes("="))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, "").replace(/\\r|\\n/g, "").trim()];
    }),
);
const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

// ── load data ────────────────────────────────────────────────────────────────
const dd = JSON.parse(readFileSync(new URL("./dd-sheet-output.json", import.meta.url), "utf8"));
const xeroRis = JSON.parse(readFileSync(new URL("./xero-repeating-output.json", import.meta.url), "utf8"))
  .filter((r) => r.Status === "AUTHORISED")
  .map((r) => ({
    contact: r.Contact?.Name ?? "",
    total: r.Total ?? 0,
    lines: (r.LineItems ?? []).map((l) => l.Description ?? "").join(" || "),
  }));

const { data: plans } = await supabase
  .from("recurring_plans")
  .select("id, status, customers(name), customer_sites(name), recurring_plan_items(service_code, service_name, price_inc_gst, frequency)")
  .eq("status", "active");

const planRecords = plans.map((p) => ({
  id: p.id,
  customer: (Array.isArray(p.customers) ? p.customers[0] : p.customers)?.name ?? "",
  site: (Array.isArray(p.customer_sites) ? p.customer_sites[0] : p.customer_sites)?.name ?? "",
  items: p.recurring_plan_items ?? [],
}));

// ── matching helpers ─────────────────────────────────────────────────────────
const BRANDS = /\b(snap fitness|snap|sf|9 ?rounds?|core ?plus|coreplus|just focus|fit4eva|planet fitness|total fusion|fitness)\b/g;
const NOISE = /\b(pty|ltd|atf|t\/?a|trust|group|the|family|nominees|security|myalarm|duress intercom|duress|b2b|monitoring|intercom|homes|24\/?7|247|qld|nsw|vic|wa|sa|tas|nt|act)\b/g;

function norm(s) {
  return (s ?? "").toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
}
// distinctive location tokens: strip brand + corporate noise
function siteTokens(s) {
  const n = norm(s).replace(BRANDS, " ").replace(NOISE, " ").replace(/\s+/g, " ").trim();
  return n.split(" ").filter((w) => w.length >= 3 && !/^\d+$/.test(w));
}
function nameMatches(costName, billingName) {
  const bn = " " + norm(billingName) + " ";
  const toks = siteTokens(costName);
  if (toks.length === 0) return false;
  return toks.every((t) => bn.includes(" " + t) || bn.includes(t + " ") || bn.includes(" " + t + " ") || bn.includes(t));
}

const SERVICE_TESTS = {
  // "Bundle 250/100"-style lines are NBN too (TFBL false positive 2026-06-11)
  nbn: (t) => /nbn|bundle\s*\d|internet|\b\d{2,4}\s*\/\s*\d{2,4}\b/i.test(t),
  sim: (t) => /\bsim\b|sim card/i.test(t),
  myalarm: (t) => /my ?alarm|ifob/i.test(t),
  duress: (t) => /duress/i.test(t),
  monitoring: (t) => /monitor|b2b|back2base|alarm/i.test(t),
};

function findBilling(costName, serviceKind) {
  const test = SERVICE_TESTS[serviceKind];
  // 1. CRM plan (DD)
  for (const p of planRecords) {
    if (!(nameMatches(costName, p.site) || nameMatches(costName, p.customer) || nameMatches(p.site, costName))) continue;
    const item = p.items.find((i) => test(`${i.service_code} ${i.service_name}`));
    if (item) return { via: "DD plan", who: p.site || p.customer, detail: `${item.service_name} $${item.price_inc_gst}/${item.frequency}` };
  }
  // 2. Xero RI
  for (const r of xeroRis) {
    if (!(nameMatches(costName, r.contact) || nameMatches(r.contact, costName))) continue;
    if (test(r.lines)) return { via: "Xero RI", who: r.contact, detail: `$${r.total} — ${r.lines.slice(0, 60)}` };
  }
  // closest name-only candidates for the report
  const near = new Set();
  for (const p of planRecords) if (nameMatches(costName, p.site) || nameMatches(p.site, costName)) near.add(`plan:${p.site}`);
  for (const r of xeroRis) if (nameMatches(costName, r.contact) || nameMatches(r.contact, costName)) near.add(`xero:${r.contact}`);
  return { via: null, near: [...near].slice(0, 3) };
}

const INTERNAL = /centrefit|cf 4g|cf router|cft\d|warner office|test/i;
// Mitchell-confirmed dispositions 2026-06-11: Just Focus services are all
// accounted for (internal arrangement); Michael Murphy, Mark Pearce and Sue
// Pearce are staff comps. Excluded from the leak list, not counted.
const CONFIRMED_OK = /just ?focus|michael murphy|mark pearce|sue pearce/i;

// ── build cost rows ──────────────────────────────────────────────────────────
const PLAN_PRICE = { "100/20": 129, "100/40": 139, "250/100": 149, "500/200": 169, "1000/400": 239, "2000/500": 339, "25/10": 110, "50/20": 110 };

const kinetixRows = dd["Kinetix "].slice(1)
  .filter((r) => r[7] && /active/i.test(String(r[3] ?? "")))
  .map((r) => ({
    kind: "nbn",
    name: String(r[7]).trim(),
    extra: `${String(r[6] ?? "").trim()} ${String(r[10] ?? "").trim()} ${String(r[11] ?? "").trim()}`.trim(),
    estimate: PLAN_PRICE[String(r[6] ?? "").trim().replace(/ ?mp?bs/i, "")] ?? 139,
  }));

const m2mRows = dd["M2M "].slice(1)
  .filter((r) => r[0])
  .map((r) => ({ kind: "sim", name: String(r[0]).trim(), extra: "", estimate: 24.75 }));

const sentinelRows = dd["Sentinel "].slice(1)
  .filter((r) => r[0])
  .map((r) => {
    const raw = String(r[0]).trim();
    const kind = /my ?alarm/i.test(raw) ? "myalarm" : /duress/i.test(raw) ? "duress" : "monitoring";
    const est = kind === "myalarm" ? 146.85 / 12 : kind === "duress" ? 12.1 : 60.5;
    return { kind, name: raw, extra: String(r[1] ?? "").trim(), estimate: est };
  });

// ── reconcile ────────────────────────────────────────────────────────────────
const buckets = { dd: [], xero: [], unbilled: [], internal: [] };
for (const row of [...kinetixRows, ...m2mRows, ...sentinelRows]) {
  if (INTERNAL.test(row.name) || CONFIRMED_OK.test(row.name)) { buckets.internal.push(row); continue; }
  const m = findBilling(row.name, row.kind);
  if (m.via === "DD plan") buckets.dd.push({ ...row, ...m });
  else if (m.via === "Xero RI") buckets.xero.push({ ...row, ...m });
  else buckets.unbilled.push({ ...row, near: m.near });
}

// ── report ───────────────────────────────────────────────────────────────────
const leak = buckets.unbilled.reduce((s, r) => s + r.estimate, 0);
let md = `# Billing reconciliation — ${new Date().toISOString().slice(0, 10)}\n\n`;
md += `Cost side: ${kinetixRows.length} Kinetix NBN + ${m2mRows.length} M2M SIMs + ${sentinelRows.length} Sentinel monitored = ${kinetixRows.length + m2mRows.length + sentinelRows.length} services we pay for.\n`;
md += `Billing side: ${planRecords.length} active CRM plans, ${xeroRis.length} authorised Xero RIs.\n\n`;
md += `| Bucket | Count | Est. monthly value |\n|---|---|---|\n`;
md += `| Billed via DD plan | ${buckets.dd.length} | — |\n| Billed via Xero RI only | ${buckets.xero.length} | — |\n| **UNBILLED** | **${buckets.unbilled.length}** | **$${leak.toFixed(2)}/mo** |\n| Internal | ${buckets.internal.length} | — |\n\n`;

md += `## ❌ UNBILLED (no matching DD plan or authorised Xero RI)\n\n| Service | Site/Customer | Detail | Est $/mo | Near-matches found |\n|---|---|---|---|---|\n`;
for (const r of buckets.unbilled.sort((a, b) => b.estimate - a.estimate)) {
  md += `| ${r.kind} | ${r.name} | ${r.extra} | $${r.estimate.toFixed(2)} | ${(r.near ?? []).join("; ") || "none"} |\n`;
}
md += `\n## ⚠ Billed via Xero RI only (no DD — manual invoice, churn/miss risk)\n\n| Service | Site/Customer | Xero contact | Detail |\n|---|---|---|---|\n`;
for (const r of buckets.xero) md += `| ${r.kind} | ${r.name} | ${r.who} | ${r.detail} |\n`;
md += `\n## ✅ Billed via DD plan\n\n| Service | Site/Customer | Plan | Detail |\n|---|---|---|---|\n`;
for (const r of buckets.dd) md += `| ${r.kind} | ${r.name} | ${r.who} | ${r.detail} |\n`;
md += `\n## Internal (not billable)\n\n${buckets.internal.map((r) => `- ${r.kind}: ${r.name}`).join("\n")}\n`;

writeFileSync(new URL("./recon-report.md", import.meta.url), md);
console.log(`Cost rows: ${kinetixRows.length + m2mRows.length + sentinelRows.length} (nbn ${kinetixRows.length}, sim ${m2mRows.length}, sentinel ${sentinelRows.length})`);
console.log(`DD-billed: ${buckets.dd.length} | Xero-only: ${buckets.xero.length} | UNBILLED: ${buckets.unbilled.length} | internal: ${buckets.internal.length}`);
console.log(`Estimated leak: $${leak.toFixed(2)}/month`);
console.log(`Report: scripts/recon-report.md`);
