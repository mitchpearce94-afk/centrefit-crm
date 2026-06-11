// List Purple Fitness authorised repeating templates (duplicate check).
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const env = Object.fromEntries(
  readFileSync(new URL("../.env.gc-probe", import.meta.url), "utf8")
    .split("\n").filter((l) => l.includes("="))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, "").replace(/\\r|\\n/g, "").trim()]; }),
);
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const { data: conn } = await sb.from("xero_connections").select("id, tenant_id, access_token, refresh_token, expires_at").order("updated_at", { ascending: false }).limit(1).single();
if (!conn.expires_at || new Date(conn.expires_at).getTime() < Date.now() + 60000) {
  const res = await fetch("https://identity.xero.com/connect/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Authorization: "Basic " + Buffer.from(`${env.XERO_CLIENT_ID}:${env.XERO_CLIENT_SECRET}`).toString("base64") },
    body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: conn.refresh_token }),
  });
  const t = await res.json();
  conn.access_token = t.access_token;
  await sb.from("xero_connections").update({ access_token: t.access_token, refresh_token: t.refresh_token ?? conn.refresh_token, expires_at: new Date(Date.now() + (t.expires_in ?? 1800) * 1000).toISOString(), updated_at: new Date().toISOString() }).eq("id", conn.id);
}
const res2 = await fetch("https://api.xero.com/api.xro/2.0/RepeatingInvoices", {
  headers: { Authorization: `Bearer ${conn.access_token}`, "Xero-tenant-id": conn.tenant_id, Accept: "application/json" },
});
const text = await res2.text();
if (!res2.ok || !text) {
  console.error(`RIs fetch HTTP ${res2.status}; retry-after=${res2.headers.get("retry-after") ?? "-"}; body=${(text ?? "").slice(0, 200)}`);
  process.exit(1);
}
const r = JSON.parse(text);
for (const ri of r.RepeatingInvoices ?? []) {
  if (ri.Status !== "AUTHORISED" || !/purple/i.test(ri.Contact?.Name ?? "")) continue;
  const m = /\/Date\((\d+)/.exec(ri.Schedule?.NextScheduledDate ?? "");
  const next = m ? new Date(Number(m[1])).toISOString().slice(0, 10) : "?";
  console.log(`${ri.RepeatingInvoiceID} | $${ri.Total} ${ri.Schedule.Period}x${ri.Schedule.Unit} | next ${next} | ${(ri.LineItems ?? []).map((l) => l.Description?.slice(0, 55)).join(" / ")}`);
}
