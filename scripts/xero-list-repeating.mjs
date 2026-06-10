// Read-only: list ALL Xero repeating invoices (contact, lines, total, status).
// Token from xero_connections (refreshes if expired, writes the fresh token
// back like the CRM client does). Output: scripts/xero-repeating-output.json
// + console summary.
import { readFileSync, writeFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const env = Object.fromEntries(
  readFileSync(new URL("../.env.gc-probe", import.meta.url), "utf8")
    .split("\n").filter((l) => l.includes("="))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, "").replace(/\\r|\\n/g, "").trim()];
    }),
);
const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const { data: conn, error } = await supabase
  .from("xero_connections")
  .select("id, tenant_id, access_token, refresh_token, expires_at")
  .order("updated_at", { ascending: false })
  .limit(1)
  .single();
if (error || !conn) { console.error("No Xero connection:", error?.message); process.exit(1); }

let accessToken = conn.access_token;
const expired = !conn.expires_at || new Date(conn.expires_at).getTime() < Date.now() + 60_000;
if (expired) {
  const res = await fetch("https://identity.xero.com/connect/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: "Basic " + Buffer.from(`${env.XERO_CLIENT_ID}:${env.XERO_CLIENT_SECRET}`).toString("base64"),
    },
    body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: conn.refresh_token }),
  });
  const tok = await res.json();
  if (!res.ok) { console.error("Token refresh failed:", JSON.stringify(tok)); process.exit(1); }
  accessToken = tok.access_token;
  await supabase.from("xero_connections").update({
    access_token: tok.access_token,
    refresh_token: tok.refresh_token ?? conn.refresh_token,
    expires_at: new Date(Date.now() + (tok.expires_in ?? 1800) * 1000).toISOString(),
    updated_at: new Date().toISOString(),
  }).eq("id", conn.id);
}

const res = await fetch("https://api.xero.com/api.xro/2.0/RepeatingInvoices", {
  headers: {
    Authorization: `Bearer ${accessToken}`,
    "Xero-tenant-id": conn.tenant_id,
    Accept: "application/json",
  },
});
const data = await res.json();
if (!res.ok) { console.error("RepeatingInvoices failed:", res.status, JSON.stringify(data).slice(0, 400)); process.exit(1); }

const ris = data.RepeatingInvoices ?? [];
writeFileSync(new URL("./xero-repeating-output.json", import.meta.url), JSON.stringify(ris, null, 2));

console.log(`Total repeating invoices: ${ris.length}`);
const byStatus = {};
for (const r of ris) byStatus[r.Status] = (byStatus[r.Status] ?? 0) + 1;
console.log("By status:", JSON.stringify(byStatus));
console.log("");
for (const r of ris.sort((a, b) => (a.Contact?.Name ?? "").localeCompare(b.Contact?.Name ?? ""))) {
  const lines = (r.LineItems ?? []).map((l) => l.Description?.slice(0, 38)).filter(Boolean).join(" | ");
  const sched = r.Schedule ? `${r.Schedule.Period}x${r.Schedule.Unit}` : "?";
  console.log(`${(r.Contact?.Name ?? "?").slice(0, 42).padEnd(42)} ${String(r.Status).padEnd(10)} $${String(r.Total ?? "?").padStart(8)} ${sched.padEnd(9)} ${lines.slice(0, 90)}`);
}
