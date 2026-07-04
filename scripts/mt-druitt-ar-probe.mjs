// 2026-07-04 — READ-ONLY: children invoices on Mt Druitt contacts (AR orphan check).
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

for (const name of ["Snap Fitness Mt Druitt", "Purple Fitness Pty Ltd ABN 84655729249"]) {
  const w = encodeURIComponent(`Contact.Name=="${name}"`);
  const invs = (await (await fetch(`https://api.xero.com/api.xro/2.0/Invoices?where=${w}&order=Date DESC&pageSize=100`, { headers: XH })).json()).Invoices ?? [];
  console.log(`\n=== ${name} — ${invs.length} invoices`);
  const byStatus = {};
  for (const i of invs) byStatus[i.Status] = (byStatus[i.Status] ?? 0) + 1;
  console.log(`  status counts: ${JSON.stringify(byStatus)}`);
  for (const i of invs.filter((x) => ["AUTHORISED", "DRAFT", "SUBMITTED"].includes(x.Status) || Number(x.Total) === 120.84 || xd(x.Date) >= "2026-05-01")) {
    console.log(`  ${i.InvoiceNumber ?? "(draft)"}  ${xd(i.Date)}  $${i.Total}  due=$${i.AmountDue}  ${i.Status}  RI=${(i.RepeatingInvoiceID ?? "-").slice(0, 8)}`);
  }
}
