// Read-only: confirm INV-5924 is VOIDED.
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
const env = Object.fromEntries(
  readFileSync(new URL("../.env.gc-probe", import.meta.url), "utf8")
    .split("\n").filter((l) => l.includes("="))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, "").replace(/\\r|\\n/g, "").trim()]; }),
);
const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const { data: conn } = await supabase.from("xero_connections").select("tenant_id, access_token").order("updated_at", { ascending: false }).limit(1).single();
const r = await fetch("https://api.xero.com/api.xro/2.0/Invoices/a6d936f5-0cf3-4bf9-b5d9-7074a7b26497", { headers: { Authorization: `Bearer ${conn.access_token}`, "Xero-tenant-id": conn.tenant_id, Accept: "application/json" } });
const inv = (await r.json()).Invoices?.[0];
console.log(`INV-5924: status=${inv?.Status} total=${inv?.Total} due=${inv?.AmountDue}`);
