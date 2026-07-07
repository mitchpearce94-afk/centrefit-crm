// 2026-07-07 — READ-ONLY: why did Snap Pakenham NBN RI skip 1 July?
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

// 1. All RIs for Pakenham
const ris = ((await (await fetch("https://api.xero.com/api.xro/2.0/RepeatingInvoices", { headers: XH })).json()).RepeatingInvoices ?? [])
  .filter((r) => (r.Contact?.Name ?? "").toLowerCase().includes("pakenham"));
console.log(`=== ${ris.length} Pakenham RI(s) ===`);
for (const r of ris) {
  const s = r.Schedule ?? {};
  console.log(`RI ${r.RepeatingInvoiceID}  status=${r.Status}  total=$${r.Total}  ref="${r.Reference ?? ""}"  theme=${r.BrandingThemeID}`);
  console.log(`   every ${s.Period} ${s.Unit}  start=${xd(s.StartDate)}  next=${xd(s.NextScheduledDate)}  end=${xd(s.EndDate)}  due=${s.DueDate}/${s.DueDateType}`);
  console.log(`   approvedForSending=${r.ApprovedForSending}  lines=[${(r.LineItems ?? []).map((l) => `${l.Description?.slice(0, 40)} $${l.LineAmount}`).join(" | ")}]`);
}

// 2. All invoices for that contact (every status), last 6 months
if (ris.length) {
  const cid = ris[0].Contact.ContactID;
  const url = `https://api.xero.com/api.xro/2.0/Invoices?ContactIDs=${cid}&Statuses=DRAFT,SUBMITTED,AUTHORISED,PAID,VOIDED,DELETED&where=${encodeURIComponent('Date>=DateTime(2026,2,1)')}&order=Date&pageSize=100`;
  const invs = (await (await fetch(url, { headers: XH })).json()).Invoices ?? [];
  console.log(`\n=== ${invs.length} invoices for "${ris[0].Contact.Name}" since Feb ===`);
  for (const i of invs) {
    console.log(`${i.InvoiceNumber ?? "(no num)"}  date=${xd(i.Date)}  $${i.Total}  ${i.Status}  sent=${i.SentToContact}  RI=${(i.RepeatingInvoiceID ?? "-").slice(0, 8)}  updated=${xd(i.UpdatedDateUTC)}`);
  }
}

// 3. CRM plan rows
const { data: plans } = await supabase.from("recurring_plans").select("*").or("site_name.ilike.%pakenham%,customer_name.ilike.%pakenham%");
if (!plans?.length) {
  const { data: p2 } = await supabase.from("recurring_plans").select("*").limit(0);
  console.log("\n(no recurring_plans matched by site_name/customer_name — column names may differ)");
} else {
  console.log(`\n=== ${plans.length} CRM recurring_plans ===`);
  for (const p of plans) console.log(JSON.stringify(p, null, 1).slice(0, 1500));
}
