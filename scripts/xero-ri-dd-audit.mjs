// Audit Xero repeating invoices for DD customers: branding theme, schedule
// date vs GoCardless charge date, IncludePDF / MarkAsSent / ApprovedForSending.
// Read-only.
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const env = Object.fromEntries(
  readFileSync(new URL("../.env.gc-probe", import.meta.url), "utf8")
    .split("\n").filter((l) => l.includes("="))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, "").replace(/\\r|\\n/g, "").trim()]; }),
);
const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

// ── Xero auth ────────────────────────────────────────────────────────────────
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

const [risRes, themesRes] = await Promise.all([
  fetch("https://api.xero.com/api.xro/2.0/RepeatingInvoices", { headers: XH }),
  fetch("https://api.xero.com/api.xro/2.0/BrandingThemes", { headers: XH }),
]);
const ris = ((await risRes.json()).RepeatingInvoices ?? []).filter((r) => r.Status === "AUTHORISED" && r.Type === "ACCREC");
const themes = new Map(((await themesRes.json()).BrandingThemes ?? []).map((t) => [t.BrandingThemeID, t.Name]));

// ── CRM DD plans + their GC charge days ──────────────────────────────────────
const { data: plans } = await supabase
  .from("recurring_plans")
  .select("id, status, customers(name), customer_sites(name), recurring_plan_gc_subscriptions(gc_subscription_id, amount_cents, interval_unit, interval, day_of_month, start_date, gc_status)")
  .eq("status", "active");

const BRANDS = /\b(snap fitness|snap|sf|9 ?rounds?|core ?plus|coreplus|just focus|fit4eva|planet fitness|total fusion|fitness)\b/g;
const NOISE = /\b(pty|ltd|atf|t\/?a|trust|group|the|family|nominees|security|myalarm|duress intercom|duress|b2b|monitoring|intercom|homes|24\/?7|247)\b/g;
const norm = (s) => (s ?? "").toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
const toks = (s) => norm(s).replace(BRANDS, " ").replace(NOISE, " ").replace(/\s+/g, " ").trim().split(" ").filter((w) => w.length >= 3 && !/^\d+$/.test(w));
const matches = (a, b) => { const bn = " " + norm(b) + " "; const t = toks(a); return t.length > 0 && t.every((x) => bn.includes(x)); };

// charge day(s) per plan from live GC subs
function chargeDays(plan) {
  const subs = (plan.recurring_plan_gc_subscriptions ?? []).filter((s) => s.gc_status !== "cancelled");
  const days = new Set();
  for (const s of subs) {
    if (s.interval_unit === "monthly") {
      days.add(s.day_of_month ?? (s.start_date ? Number(s.start_date.slice(8, 10)) : null));
    }
  }
  return [...days].filter(Boolean);
}

function xeroDate(ms) {
  const m = /\/Date\((\d+)/.exec(ms ?? "");
  return m ? new Date(Number(m[1])) : null;
}

console.log("DD customer RI audit — AUTHORISED sales RIs matched to active plans\n");
const rows = [];
for (const p of plans) {
  const cust = (Array.isArray(p.customers) ? p.customers[0] : p.customers)?.name ?? "";
  const site = (Array.isArray(p.customer_sites) ? p.customer_sites[0] : p.customer_sites)?.name ?? "";
  const days = chargeDays(p);
  const matched = ris.filter((r) => {
    const n = r.Contact?.Name ?? "";
    return matches(site, n) || matches(n, site) || matches(cust, n) || (cust && matches(n, cust));
  });
  for (const r of matched) {
    const next = xeroDate(r.Schedule?.NextScheduledDate);
    const nextDay = next ? next.getUTCDate() : null;
    const dateOk = days.length === 0 ? "n/a" : days.includes(nextDay) ? "OK" : `MISMATCH (RI day ${nextDay} vs GC day ${days.join("/")})`;
    rows.push({
      site: site || cust,
      contact: r.Contact?.Name,
      total: r.Total,
      theme: themes.get(r.BrandingThemeID) ?? "?",
      next: next ? next.toISOString().slice(0, 10) : "?",
      dateOk,
      pdf: r.IncludePDF === true ? "✓" : "✗",
      markSent: r.MarkAsSent === true ? "✓" : "✗",
      emailed: r.ApprovedForSending === true ? "✓" : "✗",
      id: r.RepeatingInvoiceID,
    });
  }
}
rows.sort((a, b) => a.site.localeCompare(b.site));
for (const r of rows) {
  console.log(`${r.site.slice(0, 28).padEnd(28)} | $${String(r.total).padStart(8)} | theme: ${String(r.theme).padEnd(22)} | next ${r.next} ${r.dateOk.padEnd(30)} | pdf ${r.pdf} | markSent ${r.markSent} | emailed ${r.emailed}`);
}
console.log(`\n${rows.length} RIs matched to active DD plans.`);
const themeCounts = {};
for (const r of rows) themeCounts[r.theme] = (themeCounts[r.theme] ?? 0) + 1;
console.log("Theme spread:", JSON.stringify(themeCounts));
console.log(`Date mismatches: ${rows.filter((r) => r.dateOk.startsWith("MISMATCH")).length}`);
console.log(`Missing PDF: ${rows.filter((r) => r.pdf === "✗").length} | Not markAsSent: ${rows.filter((r) => r.markSent === "✗").length} | Not auto-emailed: ${rows.filter((r) => r.emailed === "✗").length}`);
