// READ-ONLY: all ACCPAY bills awaiting payment, with amounts and dates,
// plus each bill's payment history (incl. deleted payments where visible).
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

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
  if (!res.ok) { console.error(`[WARN] ${path.split("?")[0]}:`, res.status, text.slice(0, 120)); return null; }
  return data;
};
const pd = (d) => { const m = /\/Date\((\d+)/.exec(d); return m ? new Date(Number(m[1])).toISOString().slice(0, 10) : String(d).slice(0, 10); };
const money = (n) => (n ?? 0).toLocaleString("en-AU", { style: "currency", currency: "AUD" });

const bills = [];
for (let page = 1; ; page++) {
  const where = encodeURIComponent('Type=="ACCPAY" AND Status=="AUTHORISED"');
  const data = await xeroGet(`Invoices?where=${where}&order=Date&page=${page}`);
  if (!data) break;
  const batch = data.Invoices ?? [];
  bills.push(...batch);
  if (batch.length < 100) break;
}

console.log(`Bills awaiting payment: ${bills.length}, total due ${money(bills.reduce((s, b) => s + (b.AmountDue ?? 0), 0))}`);
console.log("");
for (const b of bills.sort((a, c) => (a.Date ?? "").localeCompare(c.Date ?? ""))) {
  console.log(`${pd(b.Date)}  due=${pd(b.DueDate)}  ${money(b.AmountDue).padStart(12)} of ${money(b.Total).padStart(12)}  ${(b.Contact?.Name ?? "?").slice(0, 38).padEnd(40)} ${b.InvoiceNumber ?? ""}${(b.AmountPaid ?? 0) > 0 ? `  [paid so far: ${money(b.AmountPaid)}]` : ""}${(b.AmountCredited ?? 0) > 0 ? `  [credited: ${money(b.AmountCredited)}]` : ""}`);
}
