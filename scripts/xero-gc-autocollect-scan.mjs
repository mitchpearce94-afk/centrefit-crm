// Find where Xero's GoCardless auto-collect is wired AND overlapping with
// CRM/native GC subscriptions (double-charge risk). Detection is empirical:
// the Xero-GC app's payments carry description "Payment for invoice(s) ...",
// native subscription charges carry the subscription name. Read-only.
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const env = Object.fromEntries(
  readFileSync(new URL("../.env.gc-probe", import.meta.url), "utf8")
    .split("\n").filter((l) => l.includes("="))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, "").replace(/\\r|\\n/g, "").trim()]; }),
);
const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const GC = { Authorization: `Bearer ${env.GOCARDLESS_API_TOKEN}`, "GoCardless-Version": "2015-07-06", Accept: "application/json" };

// ── all GC payments since Sep 2025 ──────────────────────────────────────────
const payments = [];
let after = null;
for (let i = 0; i < 30; i++) {
  let url = "https://api.gocardless.com/payments?limit=500&created_at%5Bgte%5D=2025-09-01T00:00:00Z";
  if (after) url += `&after=${after}`;
  const r = await (await fetch(url, { headers: GC })).json();
  payments.push(...(r.payments ?? []));
  after = r.meta?.cursors?.after;
  if (!after) break;
}
console.log(`payments since Sep 2025: ${payments.length}`);

const integrationPays = payments.filter((p) => /payment for invoice/i.test(p.description ?? ""));
const subPays = payments.filter((p) => p.links?.subscription);

// group by mandate
const byMandate = new Map();
for (const p of integrationPays) {
  const m = p.links?.mandate;
  if (!byMandate.has(m)) byMandate.set(m, []);
  byMandate.get(m).push(p);
}
const subMandates = new Set(subPays.map((p) => p.links?.mandate));

// active subscriptions per mandate (current state, not just history)
async function activeSubs(mandateId) {
  const r = await (await fetch(`https://api.gocardless.com/subscriptions?mandate=${mandateId}&status=active&limit=20`, { headers: GC })).json();
  return r.subscriptions ?? [];
}

// resolve customer names
async function customerOf(mandateId) {
  const m = (await (await fetch(`https://api.gocardless.com/mandates/${mandateId}`, { headers: GC })).json()).mandates;
  const c = (await (await fetch(`https://api.gocardless.com/customers/${m.links.customer}`, { headers: GC })).json()).customers;
  return { mandate: m, name: c.company_name || `${c.given_name ?? ""} ${c.family_name ?? ""}`.trim(), email: c.email };
}

// CRM plans by mandate
const { data: plans } = await supabase
  .from("recurring_plans")
  .select("id, status, gc_mandate_id, customers(name), customer_sites(name)")
  .neq("status", "cancelled");
const planByMandate = new Map((plans ?? []).map((p) => [p.gc_mandate_id, p]));

console.log(`\nMandates with Xero auto-collect activity: ${byMandate.size}`);
console.log("=".repeat(70));
for (const [mandateId, pays] of byMandate) {
  const { name, email } = await customerOf(mandateId);
  const subs = await activeSubs(mandateId);
  const plan = planByMandate.get(mandateId);
  const site = plan ? ((Array.isArray(plan.customer_sites) ? plan.customer_sites[0] : plan.customer_sites)?.name ?? "") : "";
  const overlap = subs.length > 0;
  const recent = pays.sort((a, b) => (b.charge_date ?? "").localeCompare(a.charge_date ?? "")).slice(0, 4);
  console.log(`\n${overlap ? "⚠ DOUBLE-UP RISK" : "ok (no active subs)"} — ${name} <${email}> ${site ? `[CRM: ${site}]` : "[no CRM plan]"}`);
  console.log(`  mandate ${mandateId} | xero-collect payments: ${pays.length} | active GC subs: ${subs.length}`);
  for (const p of recent) console.log(`    xero-collect ${p.charge_date} $${(p.amount / 100).toFixed(2)} [${p.status}] "${(p.description ?? "").slice(0, 60)}"`);
  for (const s of subs) console.log(`    active sub   $${(s.amount / 100).toFixed(2)}/${s.interval ?? 1}x${s.interval_unit} "${s.name}"`);
}
