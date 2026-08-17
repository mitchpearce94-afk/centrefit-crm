// READ-ONLY: fetch a bill by number, show its payments + full history/audit.
// Usage: node xero-invoice-history-probe.mjs INV-22857
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const TARGET = process.argv[2] ?? "INV-22857";

const env = Object.fromEntries(
  readFileSync(new URL("../.env.gc-probe", import.meta.url), "utf8")
    .split("\n").filter((l) => l.includes("="))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, "").replace(/\\r|\\n/g, "").replace(/\r|\n/g, "").trim()];
    }),
);
const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const { data: conn } = await supabase.from("xero_connections")
  .select("id, tenant_id, access_token, refresh_token, expires_at")
  .order("updated_at", { ascending: false }).limit(1).single();

let accessToken = conn.access_token;
if (!conn.expires_at || new Date(conn.expires_at).getTime() < Date.now() + 60_000) {
  const res = await fetch("https://identity.xero.com/connect/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: "Basic " + Buffer.from(`${env.XERO_CLIENT_ID}:${env.XERO_CLIENT_SECRET}`).toString("base64"),
    },
    body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: conn.refresh_token }),
  });
  const tok = await res.json();
  if (!res.ok) { console.error("refresh failed", JSON.stringify(tok)); process.exit(1); }
  accessToken = tok.access_token;
  await supabase.from("xero_connections").update({
    access_token: tok.access_token,
    refresh_token: tok.refresh_token ?? conn.refresh_token,
    expires_at: new Date(Date.now() + (tok.expires_in ?? 1800) * 1000).toISOString(),
    updated_at: new Date().toISOString(),
  }).eq("id", conn.id);
}

const xeroGet = async (path) => {
  const res = await fetch(`https://api.xero.com/api.xro/2.0/${path}`, {
    headers: { Authorization: `Bearer ${accessToken}`, "Xero-tenant-id": conn.tenant_id, Accept: "application/json" },
  });
  const text = await res.text();
  let data = null; try { data = JSON.parse(text); } catch {}
  if (!res.ok) { console.error(`[WARN] ${path.split("?")[0]}:`, res.status, text.slice(0, 150)); return null; }
  return data;
};
const pd = (d) => { const m = /\/Date\((\d+)/.exec(d); return m ? new Date(Number(m[1])).toISOString() .slice(0, 16).replace("T", " ") : String(d).slice(0, 16); };

const list = await xeroGet(`Invoices?InvoiceNumbers=${encodeURIComponent(TARGET)}`);
const inv = list?.Invoices?.[0];
if (!inv) { console.error("Bill not found:", TARGET); process.exit(1); }
console.log(`${inv.InvoiceNumber}  ${inv.Contact?.Name}  total=${inv.Total}  due=${inv.AmountDue}  status=${inv.Status}`);

const full = await xeroGet(`Invoices/${inv.InvoiceID}`);
const payments = full?.Invoices?.[0]?.Payments ?? [];
console.log(`\nPayments currently on the bill: ${payments.length}`);
for (const p of payments) console.log(`  ${pd(p.Date)}  ${p.Amount}  status=${p.Status ?? "?"}  ref=${p.Reference ?? ""}  batch=${p.BatchPayment?.BatchPaymentID ?? p.BatchPaymentID ?? "-"}`);

const hist = await xeroGet(`Invoices/${inv.InvoiceID}/History`);
console.log(`\nHistory (newest first):`);
for (const h of (hist?.HistoryRecords ?? []).slice(0, 15)) {
  console.log(`  ${pd(h.DateUTC)}  [${h.Changes ?? "?"}] ${(h.User ?? "").padEnd(20)} ${(h.Details ?? "").slice(0, 110)}`);
}
