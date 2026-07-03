// Read-only: classify active plans with xero_repeating_invoice_id NULL into
// (a) legacy Xero RI exists but unlinked vs (b) NO Xero RI at all (debited,
// never invoiced — the Glenmore Park class). Also dump RI detail for
// Preston / Woodend / Windaroo to verify suspected duplicate $139 templates.
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

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
const XH = { Authorization: `Bearer ${tok}`, "Xero-tenant-id": conn.tenant_id, Accept: "application/json" };

const risRes = await fetch("https://api.xero.com/api.xro/2.0/RepeatingInvoices", { headers: XH });
const ris = ((await risRes.json()).RepeatingInvoices ?? []).filter((r) => r.Status === "AUTHORISED" && r.Type === "ACCREC");

// Same fuzzy matcher as xero-ri-dd-audit.mjs
const BRANDS = /\b(snap fitness|snap|sf|9 ?rounds?|core ?plus|coreplus|just focus|fit4eva|planet fitness|total fusion|fitness)\b/g;
const NOISE = /\b(pty|ltd|atf|t\/?a|trust|group|the|family|nominees|security|myalarm|duress intercom|duress|b2b|monitoring|intercom|homes|24\/?7|247)\b/g;
const norm = (s) => (s ?? "").toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
const toks = (s) => norm(s).replace(BRANDS, " ").replace(NOISE, " ").replace(/\s+/g, " ").trim().split(" ").filter((w) => w.length >= 3 && !/^\d+$/.test(w));
const matches = (a, b) => { const bn = " " + norm(b) + " "; const t = toks(a); return t.length > 0 && t.every((x) => bn.includes(x)); };

const { data: plans } = await supabase
  .from("recurring_plans")
  .select("id, customers(name), customer_sites(name)")
  .eq("status", "active")
  .is("xero_repeating_invoice_id", null);

console.log(`${plans.length} active plans with no linked RI — classifying against ${ris.length} AUTHORISED Xero RIs:\n`);
const orphans = [];
for (const p of plans) {
  const cust = (Array.isArray(p.customers) ? p.customers[0] : p.customers)?.name ?? "";
  const site = (Array.isArray(p.customer_sites) ? p.customer_sites[0] : p.customer_sites)?.name ?? "";
  const matched = ris.filter((r) => {
    const n = r.Contact?.Name ?? "";
    return matches(site, n) || matches(n, site) || matches(cust, n) || (cust && matches(n, cust));
  });
  const label = site || cust;
  if (matched.length === 0) {
    orphans.push(label);
    console.log(`NO XERO RI AT ALL       | ${label}`);
  } else {
    console.log(`legacy RI exists (x${matched.length})   | ${label.padEnd(32)} | ${matched.map((r) => "$" + r.Total).join(", ")}`);
  }
}
console.log(`\n=> ${orphans.length} plans debited by GC with NO Xero RI: ${orphans.join(" | ")}`);

console.log("\n── Preston / Woodend / Windaroo RI detail:");
const xd = (ms) => { const m = /\/Date\((\d+)/.exec(ms ?? ""); return m ? new Date(Number(m[1])).toISOString().slice(0, 10) : "?"; };
const themeNames = { "8df39a01-d87b-46a3-85cb-38225ea667f1": "CommsDD", "00b4c929-b051-4fbe-ac6e-6ef515fd8790": "SolutionsDD" };
for (const r of ris) {
  const n = r.Contact?.Name ?? "";
  if (/preston|woodend|windaroo/i.test(n)) {
    console.log(`${n.padEnd(30)} | $${String(r.Total).padStart(8)} | ${themeNames[r.BrandingThemeID] ?? "theme:" + r.BrandingThemeID} | next ${xd(r.Schedule?.NextScheduledDate)} | ${r.RepeatingInvoiceID}`);
    for (const li of r.LineItems ?? []) console.log(`    · ${li.Description?.slice(0, 70)} ($${li.LineAmount})`);
  }
}
