// D2 retry: delete Purple Fitness (Mt Druitt) 13xWEEKLY $120.84 B2B RI —
// pinned b81ed625-bc03-4eee-b83c-66df000399ba. GC collects this service
// MONTHLY (day 15); the aligned monthly RI a7bd2735 was created tonight.
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const env = Object.fromEntries(
  readFileSync(new URL("../.env.gc-probe", import.meta.url), "utf8")
    .split("\n").filter((l) => l.includes("="))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, "").replace(/\\r|\\n/g, "").trim()]; }),
);
const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const { data: conn } = await supabase.from("xero_connections").select("tenant_id, access_token").order("updated_at", { ascending: false }).limit(1).single();
const XH = { Authorization: `Bearer ${conn.access_token}`, "Xero-tenant-id": conn.tenant_id, Accept: "application/json", "Content-Type": "application/json" };

const ID = "b81ed625-bc03-4eee-b83c-66df000399ba";
const cur = (await (await fetch(`https://api.xero.com/api.xro/2.0/RepeatingInvoices/${ID}`, { headers: XH })).json()).RepeatingInvoices?.[0];
if (!cur) throw new Error("RI not found");
if (cur.Status !== "AUTHORISED" || Math.abs(cur.Total - 120.84) > 0.01 || cur.Schedule?.Period !== 13 || cur.Schedule?.Unit !== "WEEKLY")
  throw new Error(`guard failed: status=${cur.Status} total=${cur.Total} sched=${cur.Schedule?.Period}x${cur.Schedule?.Unit}`);
const res = await fetch(`https://api.xero.com/api.xro/2.0/RepeatingInvoices/${ID}`, { method: "POST", headers: XH, body: JSON.stringify({ RepeatingInvoiceID: ID, Status: "DELETED" }) });
if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
console.log(`OK — deleted ${ID} (PF 13xWEEKLY $120.84 B2B)`);
