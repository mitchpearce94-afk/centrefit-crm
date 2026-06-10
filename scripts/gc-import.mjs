// One-off GoCardless → CRM recurring-plan import (2026-06-10).
//
// What it does (idempotent — safe to re-run):
//  1. Backfills recurring_plan_gc_subscriptions link rows for the 13 existing
//     CRM plans from their recorded gc_subscription_id columns.
//  2. Relinks the 4 plans whose recorded subs are dead (Sunshine, Wantirna,
//     Armadale, Hampton) to the subscriptions actually charging in GC.
//  3. Imports every remaining live legacy GC subscription as CRM recurring
//     plans: matches/creates customer + site, maps each sub to a catalogue
//     service, writes plan + items + link rows (source='imported').
//
// It does NOT touch GoCardless or Xero — pure CRM data capture. Duplicate-sub
// cancellation and Xero RI swaps are deliberate, gated, separate actions.
//
// Usage: node scripts/gc-import.mjs --dry   (report only)
//        node scripts/gc-import.mjs         (write)
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const DRY = process.argv.includes("--dry");

// ── env ──────────────────────────────────────────────────────────────────────
const env = Object.fromEntries(
  readFileSync(new URL("../.env.gc-probe", import.meta.url), "utf8")
    .split("\n")
    .filter((l) => l.includes("="))
    .map((l) => {
      const i = l.indexOf("=");
      let v = l.slice(i + 1).trim().replace(/^"|"$/g, "").replace(/\\r|\\n/g, "").trim();
      return [l.slice(0, i).trim(), v];
    }),
);
const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

// ── GC discovery data ────────────────────────────────────────────────────────
const gc = JSON.parse(readFileSync(new URL("./gc-discovery-output.json", import.meta.url), "utf8"));
const mandateById = new Map(gc.mandates.map((m) => [m.id, m]));
const gcCustomerById = new Map(gc.customers.map((c) => [c.id, c]));
const subById = new Map(gc.subscriptions.map((s) => [s.id, s]));

// ── CRM data ─────────────────────────────────────────────────────────────────
const { data: plans, error: e1 } = await supabase
  .from("recurring_plans")
  .select("id, customer_id, site_id, status, source, gc_customer_id, gc_mandate_id, gc_subscription_id, gc_subscription_secondary_id");
const { data: customers, error: e2 } = await supabase.from("customers").select("id, name, billing_email, type");
const { data: sites, error: e3 } = await supabase.from("customer_sites").select("id, customer_id, name, billing_email");
const { data: services, error: e4 } = await supabase.from("recurring_services").select("code, name, price_inc_gst, frequency, account_code");
const { data: links, error: e5 } = await supabase.from("recurring_plan_gc_subscriptions").select("gc_subscription_id");
for (const [label, err] of [["plans", e1], ["customers", e2], ["sites", e3], ["services", e4], ["links", e5]]) {
  if (err) { console.error(`load ${label}:`, err); process.exit(1); }
}
const linked = new Set(links.map((l) => l.gc_subscription_id));

const report = { backfilled: 0, relinked: [], plansCreated: [], customersCreated: [], sitesCreated: [], skipped: [], warnings: [] };
const createdCustomerIds = new Set();

function subLinkRow(planId, sub, source) {
  return {
    plan_id: planId,
    gc_subscription_id: sub.id,
    name: sub.name ?? null,
    amount_cents: sub.amount,
    currency: sub.currency ?? "AUD",
    interval_unit: sub.interval_unit,
    interval: sub.interval ?? 1,
    day_of_month: sub.day_of_month ?? null,
    start_date: sub.start_date ?? null,
    gc_status: sub.status,
    source,
  };
}

async function insertLink(row) {
  if (linked.has(row.gc_subscription_id)) return false;
  if (!DRY) {
    const { error } = await supabase.from("recurring_plan_gc_subscriptions").insert(row);
    if (error) { report.warnings.push(`link ${row.gc_subscription_id}: ${error.message}`); return false; }
  }
  linked.add(row.gc_subscription_id);
  return true;
}

// ── 1. backfill links for existing plans ─────────────────────────────────────
for (const p of plans) {
  for (const sid of [p.gc_subscription_id, p.gc_subscription_secondary_id]) {
    if (!sid) continue;
    const sub = subById.get(sid);
    if (!sub) { report.warnings.push(`plan ${p.id}: recorded sub ${sid} not found in GC (dead)`); continue; }
    if (await insertLink(subLinkRow(p.id, sub, "crm"))) report.backfilled++;
  }
}

// ── 2. relink broken plans (verified against GC payments 2026-06-10) ─────────
const RELINK = [
  // Sunshine: recorded subs cancelled; live per-item set charges from 2026-06-12
  { planId: "8d746236-9124-426d-90f7-959765978fbb", primary: "SB01KT37D80H9CB22X79Z1YY90JY", secondary: "SB01KT37C5VHZ0K87JQHKF0GN291", all: ["SB01KT37D80H9CB22X79Z1YY90JY", "SB01KT37DT7HGKWGXWE12M9WZX1K", "SB01KT37C5VHZ0K87JQHKF0GN291"] },
  // Wantirna
  { planId: "90d96e4c-5c77-49d0-961f-c30ea2ccbc32", primary: "SB01KT37H17APKQTCA10B7S7ZHV7", secondary: null, all: ["SB01KT37H17APKQTCA10B7S7ZHV7", "SB01KT38VBSM7N4XBN0WDCW5YMQT"] },
  // Armadale
  { planId: "629a27e9-11ab-4009-ae18-f53d7daea49f", primary: "SB01KT394NJ3MCD086M5DXCM5FMY", secondary: null, all: ["SB01KT394NJ3MCD086M5DXCM5FMY"] },
  // Hampton
  { planId: "12921bfc-adc6-4317-83a0-d9918ce57897", primary: "SB01KT39AEN9W0SFAW8QQQ8CT7RE", secondary: null, all: ["SB01KT39AEN9W0SFAW8QQQ8CT7RE"] },
];
for (const r of RELINK) {
  const plan = plans.find((p) => p.id === r.planId);
  if (!plan) { report.warnings.push(`relink: plan ${r.planId} not found`); continue; }
  // Only relink if the recorded primary is actually dead in GC
  const recordedAlive = plan.gc_subscription_id && subById.get(plan.gc_subscription_id)?.status === "active";
  if (recordedAlive) { report.skipped.push(`relink ${r.planId}: recorded sub still active, leaving alone`); continue; }
  if (!DRY) {
    const { error } = await supabase
      .from("recurring_plans")
      .update({ gc_subscription_id: r.primary, gc_subscription_secondary_id: r.secondary, updated_at: new Date().toISOString() })
      .eq("id", r.planId);
    if (error) { report.warnings.push(`relink ${r.planId}: ${error.message}`); continue; }
  }
  for (const sid of r.all) {
    const sub = subById.get(sid);
    if (sub) await insertLink(subLinkRow(r.planId, sub, "manual"));
  }
  report.relinked.push(r.planId);
}

// ── 3. import legacy subs ────────────────────────────────────────────────────
const norm = (s) => (s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

// service mapping by keywords + cadence
function mapService(sub) {
  const n = norm(sub.name);
  const dollars = sub.amount / 100;
  const freq =
    sub.interval_unit === "yearly" ? "yearly"
    : sub.interval_unit === "monthly" && (sub.interval ?? 1) === 3 ? "quarterly"
    : sub.interval_unit === "weekly" && (sub.interval ?? 1) >= 12 ? "quarterly"
    : sub.interval_unit === "weekly" ? "monthly"
    : "monthly";
  const pick = (code) => services.find((s) => s.code === code);
  let svc = null;
  if (/my ?alarm/.test(n)) svc = pick("myalarm-app");
  else if (/duress intercom.*only/.test(n)) svc = pick("duress-intercom-only");
  else if (/duress intercom|intercom/.test(n)) svc = pick("duress-intercom-sim");
  else if (/nbn/.test(n)) {
    if (/500/.test(n)) svc = pick("nbn-500-200");
    else if (/250/.test(n)) svc = pick("nbn-250-100");
    else if (/1000/.test(n)) svc = pick("nbn-1000-400");
    else if (/100 ?\/? ?20\b/.test(n) || dollars <= 130) svc = pick("nbn-100-20");
    else svc = pick("nbn-100-40");
  } else if (/security|b2b/.test(n) && /sim/.test(n)) svc = pick("security-monitoring-sim");
  else if (/security|b2b|monitoring/.test(n)) svc = pick("security-monitoring");
  else if (/duress sim|sim card|\bsim\b/.test(n)) svc = pick("sim-card");
  else if (dollars === 24.75) svc = pick("sim-card"); // legacy subs named after the site only
  return {
    service_code: svc?.code ?? "gc-import",
    service_name: sub.name || svc?.name || "Imported service",
    account_code: svc?.account_code ?? "209",
    frequency: freq,
    price_inc_gst: dollars,
  };
}

// site hint: prefer a known CRM site name inside the sub/company name, else
// a "Snap Fitness X" style prefix from the sub name, else company name
const siteNames = sites.map((s) => ({ site: s, n: norm(s.name) })).filter((x) => x.n.length >= 6);
function siteHint(sub, gcCust) {
  const hay = [norm(sub.name), norm(gcCust?.company_name)];
  let best = null;
  for (const { site, n } of siteNames) {
    for (const h of hay) {
      if (h && h.includes(n) && (!best || n.length > norm(best.name).length)) best = site;
    }
  }
  if (best) return { site: best, label: best.name };
  // extract "snap [fitness] <suburb>" prefix from the sub name
  const m = (sub.name ?? "").match(/^(Snap(?: Fitness)? [A-Za-z' ]+?)(?:\s+(?:B2B|NBN|Duress|Security|My ?Alarm|SIM|Sim)\b|$)/i);
  if (m) return { site: null, label: m[1].replace(/^Snap (?!Fitness)/i, "Snap Fitness ").trim(), hinted: true };
  // mine "t/a Snap Fitness X" style company names for the trading site name
  const cm = (gcCust?.company_name ?? "").match(/Snap Fitness [A-Za-z' ]+/i);
  if (cm) return { site: null, label: cm[0].trim() };
  return { site: null, label: gcCust?.company_name?.trim() || null };
}

const live = gc.subscriptions.filter((s) => ["active", "paused"].includes(s.status) && !linked.has(s.id));
const byMandate = new Map();
for (const s of live) {
  const mid = s.links?.mandate;
  if (!byMandate.has(mid)) byMandate.set(mid, []);
  byMandate.get(mid).push(s);
}

// helper: next occurrence of a day-of-month from today
function nextOccurrence(day) {
  const today = new Date();
  const d = Math.min(Math.max(day, 1), 28);
  const cand = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), d));
  if (cand <= today) cand.setUTCMonth(cand.getUTCMonth() + 1);
  return cand.toISOString().slice(0, 10);
}

for (const [mandateId, subs] of byMandate) {
  const mandate = mandateById.get(mandateId);
  const gcCust = mandate ? gcCustomerById.get(mandate.links?.customer) : null;
  if (!mandate || !gcCust) { report.skipped.push(`mandate ${mandateId}: no GC mandate/customer record`); continue; }
  if (!["active", "pending_submission", "submitted"].includes(mandate.status)) {
    report.skipped.push(`mandate ${mandateId} (${gcCust.company_name ?? gcCust.email}): mandate status ${mandate.status}`);
    continue;
  }

  // bucket subs by site hint; subs with no site signal at all are deferred
  // and merged into the busiest hinted bucket (legacy naming is inconsistent
  // — "MyAlarm iFob App" on a single-site mandate belongs with the rest)
  const buckets = new Map();
  const unhinted = [];
  for (const s of subs) {
    const hint = siteHint(s, gcCust);
    const fromSubName = hint.site || hint.hinted;
    if (!fromSubName) { unhinted.push({ s, hint }); continue; }
    const key = hint.site ? `site:${hint.site.id}` : `label:${norm(hint.label ?? gcCust.email)}`;
    if (!buckets.has(key)) buckets.set(key, { hint, subs: [] });
    buckets.get(key).subs.push(s);
  }
  if (unhinted.length) {
    if (buckets.size > 0) {
      const biggest = [...buckets.values()].sort((a, b) => b.subs.length - a.subs.length)[0];
      biggest.subs.push(...unhinted.map((u) => u.s));
      if (buckets.size > 1) report.warnings.push(`mandate ${mandateId} (${gcCust.company_name ?? gcCust.email}): ${unhinted.length} sub(s) had no site hint — merged into "${biggest.hint.label ?? biggest.hint.site?.name}". Verify.`);
    } else {
      const hint = unhinted[0].hint;
      buckets.set("fallback", { hint, subs: unhinted.map((u) => u.s) });
    }
  }

  for (const { hint, subs: bucketSubs } of buckets.values()) {
    // resolve customer + site
    let site = hint.site;
    let customerId = site?.customer_id ?? null;
    if (!customerId) {
      // match customer by email then by name
      const email = (gcCust.email ?? "").toLowerCase();
      const siteWithEmail = email ? sites.find((s) => (s.billing_email ?? "").toLowerCase() === email) : null;
      const cByEmail = (email ? customers.find((c) => (c.billing_email ?? "").toLowerCase() === email) : null)
        ?? (siteWithEmail ? customers.find((c) => c.id === siteWithEmail.customer_id) : null);
      const personName = `${gcCust.given_name ?? ""} ${gcCust.family_name ?? ""}`.trim();
      const cByName = customers.find((c) => norm(c.name) === norm(gcCust.company_name) || (personName && norm(c.name) === norm(personName)));
      const found = cByEmail || cByName;
      if (found) customerId = found.id;
      else {
        const newCust = {
          name: gcCust.company_name?.trim() || personName || gcCust.email,
          type: gcCust.company_name ? "commercial" : "residential",
          billing_email: gcCust.email ?? null,
          is_active: true,
          notes: `Created by GoCardless import ${new Date().toISOString().slice(0, 10)} (GC ${gcCust.id})`,
        };
        if (!DRY) {
          const { data, error } = await supabase.from("customers").insert(newCust).select("id").single();
          if (error) { report.warnings.push(`create customer ${newCust.name}: ${error.message}`); continue; }
          customerId = data.id;
        } else customerId = `dry-cust-${norm(newCust.name)}`;
        customers.push({ id: customerId, name: newCust.name, billing_email: newCust.billing_email, type: newCust.type });
        createdCustomerIds.add(customerId);
        report.customersCreated.push(newCust.name);
      }
    }
    if (!site) {
      const label = hint.label || (gcCust.company_name ?? "").trim();
      // An entity-style label (Pty Ltd, Group…) on a pre-existing CRM customer
      // with exactly one site almost certainly means that site — don't create
      // a junk site named after the holding company.
      if (label && /\b(pty|ltd|group|nominees|trust)\b/i.test(label) && !createdCustomerIds.has(customerId)) {
        const custSites = sites.filter((s) => s.customer_id === customerId);
        if (custSites.length === 1) {
          site = custSites[0];
          report.warnings.push(`"${label}" attached to existing site "${site.name}" (only site of matched customer). Verify.`);
        }
      }
      if (!site && label) {
        const existing = sites.find((s) => s.customer_id === customerId && norm(s.name) === norm(label));
        if (existing) site = existing;
        else {
          const newSite = { customer_id: customerId, name: label, billing_email: gcCust.email ?? null };
          if (!DRY) {
            const { data, error } = await supabase.from("customer_sites").insert(newSite).select("id, customer_id, name, billing_email").single();
            if (error) { report.warnings.push(`create site ${label}: ${error.message}`); continue; }
            site = data;
          } else site = { id: `dry-site-${norm(label)}`, customer_id: customerId, name: label };
          sites.push(site);
          siteNames.push({ site, n: norm(site.name) });
          report.sitesCreated.push(label);
        }
      }
    }

    // skip if an imported plan already exists for this mandate+site
    const dup = plans.find((p) => p.gc_mandate_id === mandateId && (p.site_id ?? null) === (site?.id ?? null));
    if (dup) { report.skipped.push(`mandate ${mandateId} site ${site?.name ?? "—"}: plan exists (${dup.id})`); continue; }

    const monthlies = bucketSubs.filter((s) => s.interval_unit === "monthly" && (s.interval ?? 1) === 1).sort((a, b) => b.amount - a.amount);
    const yearlies = bucketSubs.filter((s) => s.interval_unit === "yearly");
    const anchor = monthlies[0] ?? bucketSubs[0];
    const anchorDay = anchor.day_of_month ?? (anchor.start_date ? Number(anchor.start_date.slice(8, 10)) : 1);

    const plan = {
      customer_id: customerId,
      site_id: site?.id ?? null,
      status: "active",
      source: "imported",
      gc_customer_id: gcCust.id,
      gc_mandate_id: mandateId,
      gc_subscription_id: monthlies[0]?.id ?? bucketSubs[0].id,
      gc_subscription_secondary_id: yearlies.length === 1 ? yearlies[0].id : null,
      alias_email: gcCust.email ?? null,
      next_invoice_date: nextOccurrence(anchorDay),
      first_invoice_date: bucketSubs.map((s) => s.start_date).filter(Boolean).sort()[0] ?? null,
      notes: `Imported from GoCardless ${new Date().toISOString().slice(0, 10)} — ${bucketSubs.length} legacy subscription(s) left charging as-is.`,
    };
    let planId;
    if (!DRY) {
      const { data, error } = await supabase.from("recurring_plans").insert(plan).select("id").single();
      if (error) { report.warnings.push(`create plan ${site?.name ?? gcCust.email}: ${error.message}`); continue; }
      planId = data.id;
    } else planId = `dry-plan-${norm(site?.name ?? gcCust.email)}`;
    plans.push({ ...plan, id: planId });

    const items = bucketSubs.map((s) => ({ recurring_plan_id: planId, quantity: 1, ...mapService(s) }));
    if (!DRY) {
      const { error } = await supabase.from("recurring_plan_items").insert(
        items.map(({ service_code, service_name, account_code, frequency, price_inc_gst, recurring_plan_id, quantity }) => ({
          recurring_plan_id, service_code, service_name, account_code, frequency, price_inc_gst, quantity,
        })),
      );
      if (error) report.warnings.push(`items for ${site?.name}: ${error.message}`);
    }
    for (const s of bucketSubs) await insertLink(subLinkRow(planId, s, "imported"));

    report.plansCreated.push({
      customer: customers.find((c) => c.id === customerId)?.name,
      site: site?.name ?? "—",
      subs: bucketSubs.length,
      monthly: monthlies.reduce((a, s) => a + s.amount, 0) / 100,
      items: items.map((i) => `${i.service_code}@${i.price_inc_gst}/${i.frequency}`).join(", "),
    });
  }
}

// ── report ───────────────────────────────────────────────────────────────────
console.log(`${DRY ? "[DRY RUN] " : ""}Backfilled links: ${report.backfilled}`);
console.log(`Relinked plans: ${report.relinked.length} ${JSON.stringify(report.relinked)}`);
console.log(`\nCustomers created (${report.customersCreated.length}):`);
report.customersCreated.forEach((c) => console.log(`  + ${c}`));
console.log(`\nSites created (${report.sitesCreated.length}):`);
report.sitesCreated.forEach((s) => console.log(`  + ${s}`));
console.log(`\nPlans created (${report.plansCreated.length}):`);
report.plansCreated.forEach((p) => console.log(`  + ${(p.customer ?? "?").slice(0, 30).padEnd(30)} | ${p.site.padEnd(32)} | ${String(p.subs)} subs | $${p.monthly.toFixed(2)}/mo | ${p.items}`));
console.log(`\nSkipped (${report.skipped.length}):`);
report.skipped.forEach((s) => console.log(`  - ${s}`));
console.log(`\nWarnings (${report.warnings.length}):`);
report.warnings.forEach((w) => console.log(`  ! ${w}`));
