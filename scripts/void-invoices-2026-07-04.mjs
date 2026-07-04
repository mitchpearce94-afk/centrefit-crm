// 2026-07-04 — Mitchell-authorised: void INV-5915 + INV-5929 ("they aren't real, created and not sent both times").
// Both AUTHORISED, $0 paid, never sent. Siblings INV-5916 (PP1, sent) / INV-5930 (sent) are the real ones — untouched.
// Every op pinned to explicit IDs, status+number+amount asserted before voiding.
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const DRY = process.argv.includes("--dry");

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

const TARGETS = [
  { number: "INV-5915", xeroId: "b314f203-4f68-4dcc-8bfa-65e0fa2b205e", crmId: "73d4c0ae-91b4-4e88-9d6e-f7b36cd36835", total: 30310.15 },
  { number: "INV-5929", xeroId: "ea44e226-9b44-4a9d-a4a8-c1886ed94050", crmId: "1bb72a9b-e02f-4c95-bfbb-3db3c4f38b25", total: 3685.0 },
];

for (const t of TARGETS) {
  const inv = (await (await fetch(`https://api.xero.com/api.xro/2.0/Invoices/${t.xeroId}`, { headers: XH })).json())?.Invoices?.[0];
  if (!inv) { console.error(`ABORT ${t.number}: not found in Xero`); continue; }
  const facts = `${inv.InvoiceNumber} status=${inv.Status} total=${inv.Total} paid=${inv.AmountPaid} contact=${inv.Contact?.Name}`;
  if (inv.InvoiceNumber !== t.number || inv.Status !== "AUTHORISED" || Number(inv.AmountPaid) !== 0 || Math.abs(Number(inv.Total) - t.total) > 0.01) {
    console.error(`ABORT — guard failed: ${facts}`);
    continue;
  }
  if (DRY) { console.log(`[dry] would VOID ${facts}`); continue; }
  const res = await fetch(`https://api.xero.com/api.xro/2.0/Invoices/${t.xeroId}`, {
    method: "POST", headers: XH, body: JSON.stringify({ InvoiceID: t.xeroId, Status: "VOIDED" }),
  });
  const j = await res.json().catch(() => null);
  const after = j?.Invoices?.[0]?.Status;
  if (!res.ok || after !== "VOIDED") { console.error(`FAIL ${t.number}: HTTP ${res.status} status=${after} ${JSON.stringify(j?.Elements?.[0]?.ValidationErrors ?? "").slice(0, 200)}`); continue; }
  const { error } = await supabase.from("invoices").update({ status: "void", updated_at: new Date().toISOString() }).eq("id", t.crmId);
  console.log(`OK    ${t.number} VOIDED in Xero${error ? ` (CRM update FAILED: ${error.message})` : " + CRM status=void"}`);
}
