// WRITE: void the duplicate SDA INV010901 (Email-to-Bill received twice 24 Aug,
// identical copies, both unpaid). Keeps 9a64dbed, voids 05b57d9f.
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const VOID_SDA = "05b57d9f-0b44-4b78-9f2f-f0d33aeb1d4e";

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

const hdrs = { Authorization: `Bearer ${accessToken}`, "Xero-tenant-id": conn.tenant_id, Accept: "application/json" };
const chk = await fetch(`https://api.xero.com/api.xro/2.0/Invoices/${VOID_SDA}`, { headers: hdrs }).then((r) => r.json());
const b = chk.Invoices?.[0];
if (!b || b.Status !== "AUTHORISED" || b.AmountPaid !== 0 || b.Total !== 1043.67) {
  console.error(`ABORT: state changed: status=${b?.Status} paid=${b?.AmountPaid} total=${b?.Total}`);
  process.exit(1);
}
const res = await fetch(`https://api.xero.com/api.xro/2.0/Invoices/${VOID_SDA}?summarizeErrors=false`, {
  method: "POST",
  headers: { ...hdrs, "Content-Type": "application/json" },
  body: JSON.stringify({ InvoiceID: VOID_SDA, Status: "VOIDED" }),
});
const data = await res.json();
if (!res.ok) { console.error("void failed", res.status, JSON.stringify(data).slice(0, 600)); process.exit(1); }
console.log(`SDA INV010901 dup ${VOID_SDA.slice(0, 8)} -> ${data.Invoices?.[0]?.Status}  (kept 9a64dbed)`);
