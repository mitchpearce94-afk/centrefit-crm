// Fix DD repeating invoices in Xero (Mitchell-authorised 2026-06-11):
//   --flags   set IncludePDF=true + MarkAsSent=true where missing
//   --themes  set branding: NBN lines → Communications DD, else Solutions DD
//   --dates   cadence-aware date audit (report only)
//   --setdate <riId> <YYYY-MM-DD>  move one RI's next generation date
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const MODE = process.argv[2] ?? "--dates";

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

const [risRes, themesRes] = await Promise.all([
  fetch("https://api.xero.com/api.xro/2.0/RepeatingInvoices", { headers: XH }),
  fetch("https://api.xero.com/api.xro/2.0/BrandingThemes", { headers: XH }),
]);
const allRis = ((await risRes.json()).RepeatingInvoices ?? []).filter((r) => r.Status === "AUTHORISED" && r.Type === "ACCREC");
const themes = ((await themesRes.json()).BrandingThemes ?? []);
const themeName = new Map(themes.map((t) => [t.BrandingThemeID, t.Name]));
const COMMS_DD = themes.find((t) => /communications dd/i.test(t.Name))?.BrandingThemeID;
const SOLUTIONS_DD = themes.find((t) => /solutions dd/i.test(t.Name))?.BrandingThemeID;

// ── match RIs to active DD plans ─────────────────────────────────────────────
const { data: plans } = await supabase
  .from("recurring_plans")
  .select("id, customers(name), customer_sites(name), recurring_plan_gc_subscriptions(amount_cents, interval_unit, interval, day_of_month, start_date, gc_status)")
  .eq("status", "active");

const BRANDS = /\b(snap fitness|snap|sf|9 ?rounds?|core ?plus|coreplus|just focus|fit4eva|planet fitness|total fusion|fitness)\b/g;
const NOISE = /\b(pty|ltd|atf|t\/?a|trust|group|the|family|nominees|security|myalarm|duress intercom|duress|b2b|monitoring|intercom|homes|24\/?7|247)\b/g;
const norm = (s) => (s ?? "").toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
const tk = (s) => norm(s).replace(BRANDS, " ").replace(NOISE, " ").replace(/\s+/g, " ").trim().split(" ").filter((w) => w.length >= 3 && !/^\d+$/.test(w));
const match = (a, b) => { const bn = " " + norm(b) + " "; const t = tk(a); return t.length > 0 && t.every((x) => bn.includes(x)); };

function cadenceOf(ri) {
  const u = ri.Schedule?.Unit, p = ri.Schedule?.Period ?? 1;
  if (u === "MONTHLY" && p === 1) return "monthly";
  if (u === "MONTHLY" && p === 12) return "yearly";
  if (u === "MONTHLY" && p === 3) return "quarterly";
  if (u === "WEEKLY" && p >= 12) return "quarterly";
  return `${p}x${u}`;
}
function subCadence(s) {
  if (s.interval_unit === "yearly") return "yearly";
  if (s.interval_unit === "monthly" && (s.interval ?? 1) === 3) return "quarterly";
  if (s.interval_unit === "weekly" && (s.interval ?? 1) >= 12) return "quarterly";
  return "monthly";
}
const xd = (ms) => { const m = /\/Date\((\d+)/.exec(ms ?? ""); return m ? new Date(Number(m[1])) : null; };

const matched = []; // {ri, plan, site}
for (const p of plans) {
  const cust = (Array.isArray(p.customers) ? p.customers[0] : p.customers)?.name ?? "";
  const site = (Array.isArray(p.customer_sites) ? p.customer_sites[0] : p.customer_sites)?.name ?? "";
  for (const r of allRis) {
    const n = r.Contact?.Name ?? "";
    if (match(site, n) || match(n, site) || match(cust, n) || (cust && match(n, cust))) {
      matched.push({ ri: r, plan: p, site: site || cust });
    }
  }
}
console.log(`${matched.length} authorised RIs matched to active DD plans. Mode: ${MODE}\n`);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function postRi(id, body) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(`https://api.xero.com/api.xro/2.0/RepeatingInvoices/${id}`, {
      method: "POST", headers: XH, body: JSON.stringify({ RepeatingInvoices: [body] }),
    });
    if (res.status === 429) {
      const wait = Number(res.headers.get("retry-after") ?? 5) * 1000 + 500;
      await sleep(wait);
      continue;
    }
    const text = await res.text();
    let j = null;
    try { j = text ? JSON.parse(text) : null; } catch { /* non-JSON */ }
    if (!res.ok) {
      const ve = j?.Elements?.[0]?.ValidationErrors?.map((v) => v.Message).join("; ");
      throw new Error(ve ?? `HTTP ${res.status}: ${(text ?? "").slice(0, 200)}`);
    }
    return j?.RepeatingInvoices?.[0];
  }
  throw new Error("rate-limited after retries");
}

const dstr = (ms) => { const d = xd(ms); return d ? d.toISOString().slice(0, 10) : undefined; };

// Update body: the full template round-tripped WITH RepeatingInvoiceID but
// WITHOUT Status — including Status triggers "must be set to DELETED";
// omitting the ID makes Xero treat it as a create.
function partialBody(ri, overrides = {}) {
  return {
    RepeatingInvoiceID: ri.RepeatingInvoiceID,
    Type: ri.Type,
    Contact: { ContactID: ri.Contact?.ContactID },
    Schedule: {
      Period: ri.Schedule?.Period,
      Unit: ri.Schedule?.Unit,
      DueDate: ri.Schedule?.DueDate,
      DueDateType: ri.Schedule?.DueDateType,
      StartDate: dstr(ri.Schedule?.StartDate),
      NextScheduledDate: dstr(ri.Schedule?.NextScheduledDate),
      ...(ri.Schedule?.EndDate ? { EndDate: dstr(ri.Schedule.EndDate) } : {}),
    },
    LineItems: (ri.LineItems ?? []).map((l) => ({
      Description: l.Description,
      Quantity: l.Quantity,
      UnitAmount: l.UnitAmount,
      ...(l.ItemCode ? { ItemCode: l.ItemCode } : {}),
      AccountCode: l.AccountCode,
      TaxType: l.TaxType,
      ...(l.DiscountRate ? { DiscountRate: l.DiscountRate } : {}),
    })),
    LineAmountTypes: ri.LineAmountTypes,
    ...(ri.Reference ? { Reference: ri.Reference } : {}),
    BrandingThemeID: ri.BrandingThemeID,
    CurrencyCode: ri.CurrencyCode,
    Status: "AUTHORISED",
    ApprovedForSending: ri.ApprovedForSending ?? false,
    SendCopy: ri.SendCopy ?? false,
    MarkAsSent: ri.MarkAsSent ?? false,
    IncludePDF: ri.IncludePDF ?? false,
    ...overrides,
  };
}

if (MODE === "--flags") {
  let targets = matched.filter(({ ri }) => ri.IncludePDF !== true || ri.MarkAsSent !== true);
  if (process.argv[3] === "--one") targets = targets.slice(0, 1);
  console.log(`${targets.length} RIs need flag fixes`);
  for (const { ri, site } of targets) {
    try {
      const updated = await postRi(ri.RepeatingInvoiceID, partialBody(ri, { IncludePDF: true, MarkAsSent: true }));
      await sleep(1100);
      console.log(`OK   ${site.slice(0, 28).padEnd(28)} $${ri.Total} — pdf=${updated.IncludePDF} markSent=${updated.MarkAsSent}`);
    } catch (e) {
      console.log(`FAIL ${site.slice(0, 28).padEnd(28)} $${ri.Total} — ${e.message}`);
    }
  }
}

if (MODE === "--themes") {
  if (!COMMS_DD || !SOLUTIONS_DD) { console.error("DD themes not found:", [...themeName.values()].join(", ")); process.exit(1); }
  const targets = matched.filter(({ ri }) => {
    const name = themeName.get(ri.BrandingThemeID) ?? "";
    return !/dd$/i.test(name.trim());
  });
  console.log(`${targets.length} RIs not on a DD theme`);
  for (const { ri, site } of targets) {
    const lines = (ri.LineItems ?? []).map((l) => l.Description ?? "").join(" ");
    const target = /nbn/i.test(lines) ? COMMS_DD : SOLUTIONS_DD;
    try {
      const updated = await postRi(ri.RepeatingInvoiceID, partialBody(ri, { BrandingThemeID: target }));
      await sleep(1100);
      console.log(`OK   ${site.slice(0, 28).padEnd(28)} $${ri.Total} → ${themeName.get(updated.BrandingThemeID)}`);
    } catch (e) {
      console.log(`FAIL ${site.slice(0, 28).padEnd(28)} $${ri.Total} — ${e.message}`);
    }
  }
}

if (MODE === "--dates") {
  // cadence-aware: compare each RI's next date to the GC sub of the SAME cadence
  let mismatches = 0;
  for (const { ri, plan, site } of matched) {
    const cad = cadenceOf(ri);
    const subs = (plan.recurring_plan_gc_subscriptions ?? []).filter((s) => s.gc_status !== "cancelled" && subCadence(s) === cad);
    if (subs.length === 0) continue;
    const next = xd(ri.Schedule?.NextScheduledDate);
    if (!next) continue;
    const riDay = next.getUTCDate();
    const days = subs.map((s) => s.day_of_month ?? (s.start_date ? Number(s.start_date.slice(8, 10)) : null)).filter(Boolean);
    if (days.length === 0) continue;
    if (!days.includes(riDay)) {
      mismatches++;
      // propose: same month as RI next date, GC's day (cap 28)
      const day = Math.min(days[0], 28);
      const prop = new Date(Date.UTC(next.getUTCFullYear(), next.getUTCMonth(), day));
      if (prop <= new Date()) prop.setUTCMonth(prop.getUTCMonth() + 1);
      console.log(`${site.slice(0, 28).padEnd(28)} $${String(ri.Total).padStart(8)} ${cad.padEnd(9)} RI next ${next.toISOString().slice(0, 10)} vs GC day ${days.join("/")} → propose ${prop.toISOString().slice(0, 10)}  ${ri.RepeatingInvoiceID}`);
    }
  }
  console.log(`\n${mismatches} cadence-aware date mismatches.`);
}

if (MODE === "--setdate") {
  const [, , , riId, newDate] = process.argv;
  if (!riId || !/^\d{4}-\d{2}-\d{2}$/.test(newDate ?? "")) { console.error("usage: --setdate <riId> <YYYY-MM-DD>"); process.exit(1); }
  const target = matched.find(({ ri }) => ri.RepeatingInvoiceID === riId) ?? { ri: allRis.find((r) => r.RepeatingInvoiceID === riId) };
  if (!target.ri) { console.error("RI not found"); process.exit(1); }
  const sched = target.ri.Schedule;
  const updated = await postRi(riId, partialBody(target.ri, {
    Schedule: {
      Period: sched.Period,
      Unit: sched.Unit,
      DueDate: sched.DueDate,
      DueDateType: sched.DueDateType,
      StartDate: dstr(sched.StartDate),
      NextScheduledDate: newDate,
    },
  }));
  const next = xd(updated.Schedule?.NextScheduledDate);
  console.log(`Updated. NextScheduledDate now: ${next ? next.toISOString().slice(0, 10) : JSON.stringify(updated.Schedule)}`);
}
