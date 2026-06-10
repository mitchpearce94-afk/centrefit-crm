// Investigate suspected double-up for Snap Fitness Kellyville (DVN 1 Global /
// Vipul - vpreliance5@gmail.com). Read-only: GC subs+payments, CRM plans,
// Xero RIs + recent invoices.
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const env = Object.fromEntries(
  readFileSync(new URL("../.env.gc-probe", import.meta.url), "utf8")
    .split("\n").filter((l) => l.includes("="))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, "").replace(/\\r|\\n/g, "").trim()]; }),
);
const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const GC = { Authorization: `Bearer ${env.GOCARDLESS_API_TOKEN}`, "GoCardless-Version": "2015-07-06", Accept: "application/json" };

// ── GC: all customers with the vpreliance email or kellyville-ish names ─────
const custs = (await (await fetch("https://api.gocardless.com/customers?limit=500", { headers: GC })).json()).customers ?? [];
const targets = custs.filter((c) =>
  (c.email ?? "").toLowerCase().includes("vpreliance") ||
  `${c.company_name} ${c.given_name} ${c.family_name}`.toLowerCase().includes("kellyville") ||
  `${c.company_name}`.toLowerCase().includes("dvn"));
console.log("=== GoCardless customers ===");
for (const c of targets) {
  console.log(`\n${c.id} "${c.company_name ?? ""}" ${c.given_name ?? ""} ${c.family_name ?? ""} <${c.email}>`);
  const mandates = (await (await fetch(`https://api.gocardless.com/mandates?customer=${c.id}&limit=20`, { headers: GC })).json()).mandates ?? [];
  for (const m of mandates) {
    console.log(`  mandate ${m.id} [${m.status}]`);
    const subs = (await (await fetch(`https://api.gocardless.com/subscriptions?mandate=${m.id}&limit=50`, { headers: GC })).json()).subscriptions ?? [];
    for (const s of subs) {
      console.log(`    sub ${s.id} [${s.status}] $${(s.amount / 100).toFixed(2)}/${s.interval ?? 1}x${s.interval_unit} start=${s.start_date} "${s.name}"`);
    }
    const pays = (await (await fetch(`https://api.gocardless.com/payments?mandate=${m.id}&limit=10`, { headers: GC })).json()).payments ?? [];
    for (const p of pays) {
      console.log(`    pay ${p.charge_date} $${(p.amount / 100).toFixed(2)} [${p.status}] "${p.description ?? ""}"`);
    }
  }
}

// ── CRM plans ────────────────────────────────────────────────────────────────
console.log("\n=== CRM plans (kellyville) ===");
const { data: plans } = await supabase
  .from("recurring_plans")
  .select("id, status, source, gc_mandate_id, gc_customer_id, alias_email, customers(name), customer_sites(name), recurring_plan_items(service_name, price_inc_gst, frequency)")
  .or("name.ilike.%kellyville%", { referencedTable: "customer_sites" });
const { data: allPlans } = await supabase
  .from("recurring_plans")
  .select("id, status, source, gc_mandate_id, alias_email, customers(name), customer_sites(name), recurring_plan_items(service_name, price_inc_gst, frequency)");
for (const p of allPlans ?? []) {
  const site = (Array.isArray(p.customer_sites) ? p.customer_sites[0] : p.customer_sites)?.name ?? "";
  const cust = (Array.isArray(p.customers) ? p.customers[0] : p.customers)?.name ?? "";
  if (!/kellyville/i.test(site + cust + (p.alias_email ?? ""))) continue;
  console.log(`\nplan ${p.id} [${p.status}] ${cust} / ${site} src=${p.source} mandate=${p.gc_mandate_id} alias=${p.alias_email}`);
  for (const i of p.recurring_plan_items ?? []) console.log(`   item ${i.service_name} $${i.price_inc_gst}/${i.frequency}`);
}

// ── Xero: RIs + recent invoices for DVN / Kellyville contacts ────────────────
const ris = JSON.parse(readFileSync(new URL("./xero-repeating-output.json", import.meta.url), "utf8"));
console.log("\n=== Xero repeating invoices (DVN / Kellyville contacts) ===");
for (const r of ris) {
  const n = r.Contact?.Name ?? "";
  if (!/dvn|kellyville/i.test(n)) continue;
  console.log(`${r.Status.padEnd(10)} ${n} $${r.Total} ${r.Schedule?.Period}x${r.Schedule?.Unit} — ${(r.LineItems ?? []).map((l) => l.Description?.slice(0, 50)).join(" | ")}`);
}

// recent actual invoices via Xero API
const { data: conn } = await supabase.from("xero_connections").select("tenant_id, access_token, refresh_token, expires_at, id").order("updated_at", { ascending: false }).limit(1).single();
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
const inv = await (await fetch(`https://api.xero.com/api.xro/2.0/Invoices?where=${encodeURIComponent('Contact.Name.Contains("DVN")')}&order=Date%20DESC&page=1`, {
  headers: { Authorization: `Bearer ${tok}`, "Xero-tenant-id": conn.tenant_id, Accept: "application/json" },
})).json();
console.log("\n=== Xero invoices to DVN (latest 12) ===");
for (const i of (inv.Invoices ?? []).slice(0, 12)) {
  console.log(`${i.InvoiceNumber} ${i.DateString?.slice(0, 10)} $${i.Total} [${i.Status}] paid=$${i.AmountPaid} due=$${i.AmountDue}`);
}
