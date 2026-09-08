// READ-ONLY: list fee/currency/exchange accounts in the chart.
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
  .select("tenant_id, access_token").order("updated_at", { ascending: false }).limit(1).single();

const res = await fetch("https://api.xero.com/api.xro/2.0/Accounts", {
  headers: { Authorization: `Bearer ${conn.access_token}`, "Xero-tenant-id": conn.tenant_id, Accept: "application/json" },
});
const data = await res.json();
for (const a of data.Accounts ?? []) {
  if (/fee|currency|exchange|fx/i.test(a.Name ?? "") && a.Status === "ACTIVE") {
    console.log(`${String(a.Code ?? "").padEnd(6)} ${String(a.Type).padEnd(10)} ${a.Name}`);
  }
}
