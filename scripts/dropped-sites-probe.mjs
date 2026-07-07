// 2026-07-07 — READ-ONLY: 4 sites w/ deleted no-successor RIs — map CRM plan RI pointers vs Xero live/deleted RIs.
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
const xd = (ms) => { const m = /\/Date\((\d+)/.exec(ms ?? ""); return m ? new Date(Number(m[1])).toISOString().slice(0, 10) : "?"; };

const all = ((await (await fetch("https://api.xero.com/api.xro/2.0/RepeatingInvoices", { headers: XH })).json()).RepeatingInvoices ?? []).filter((r) => r.Type === "ACCREC");

const { data: plans } = await supabase.from("recurring_plans")
  .select("id, status, xero_repeating_invoice_id, xero_repeating_invoice_secondary_id, xero_contact_id, gc_subscription_id, gc_subscription_secondary_id, customer_sites!inner(name)")
  .in("id", ["1b0cffa8-6162-4bde-8455-64b409390353", "3954215c-b804-45b3-b024-22d7b474fe79", "57e52754-e162-4377-8d36-fa55e5e223fe", "6a74bef9-5a1c-4e4d-ac3c-3b7be463a562"]);

for (const p of plans) {
  console.log(`\n=== ${p.customer_sites.name}  plan=${p.id.slice(0, 8)}  status=${p.status}  gcSubs=${[p.gc_subscription_id, p.gc_subscription_secondary_id].filter(Boolean).length}`);
  for (const [tag, id] of [["primary", p.xero_repeating_invoice_id], ["secondary", p.xero_repeating_invoice_secondary_id]]) {
    if (!id) { console.log(`  ${tag}: (none)`); continue; }
    const r = all.find((x) => x.RepeatingInvoiceID === id);
    console.log(`  ${tag}: ${id.slice(0, 8)} -> ${r ? `${r.Status} $${r.Total} "${r.Reference ?? ""}" next=${xd(r.Schedule?.NextScheduledDate)} contact="${r.Contact?.Name}"` : "NOT FOUND in Xero"}`);
  }
  // all Xero RIs (live+deleted) for this plan's contact
  const contactRis = all.filter((r) => r.Contact?.ContactID === p.xero_contact_id);
  for (const r of contactRis) {
    console.log(`    [contact RI] ${r.RepeatingInvoiceID.slice(0, 8)} ${r.Status} $${r.Total} "${r.Reference ?? ""}" every ${r.Schedule?.Period} ${r.Schedule?.Unit} next=${xd(r.Schedule?.NextScheduledDate)}`);
  }
}
