import { readFileSync, existsSync, writeFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const envFile = ["../.env.gc-probe", "../.env.local"].map((p) => new URL(p, import.meta.url)).find((u) => existsSync(u));
if (!envFile) { console.error("no .env.gc-probe / .env.local"); process.exit(1); }
const env = Object.fromEntries(
  readFileSync(envFile, "utf8").split("\n").filter((l) => l.includes("=") && !l.startsWith("#"))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, "").replace(/\\r|\\n/g, "").trim()]; }),
);
for (const k of ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "XERO_CLIENT_ID", "XERO_CLIENT_SECRET", "GOCARDLESS_API_TOKEN"]) {
  if (!env[k]) { console.error(`missing ${k} in ${envFile.pathname}`); process.exit(1); }
}
const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const { data: conn } = await supabase.from("xero_connections").select("tenant_id, access_token, rate_limited_until, rate_limited_reason").order("updated_at", { ascending: false }).limit(1).single();
console.log("CRM-recorded cooldown:", conn.rate_limited_until ?? "none", conn.rate_limited_reason ?? "");
const r = await fetch("https://api.xero.com/api.xro/2.0/Organisation", { headers: { Authorization: `Bearer ${conn.access_token}`, "Xero-tenant-id": conn.tenant_id, Accept: "application/json" } });
const h = (k) => r.headers.get(k);
console.log("status", r.status, "| day remaining", h("x-daylimit-remaining"), "| min remaining", h("x-minlimit-remaining"), "| app-min remaining", h("x-appminlimit-remaining"), "| retry-after", h("retry-after"), "| problem", h("x-rate-limit-problem"));
