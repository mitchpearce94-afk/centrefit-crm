// READ-ONLY: list bank accounts in Xero (code, name, status) so cleanup
// instructions reference the right accounts.
import { readFileSync } from "node:fs";
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
  .select("tenant_id, access_token")
  .order("updated_at", { ascending: false })
  .limit(1)
  .single();
if (error || !conn) { console.error("No Xero connection:", error?.message); process.exit(1); }

const res = await fetch(`https://api.xero.com/api.xro/2.0/Accounts?where=${encodeURIComponent('Type=="BANK"')}`, {
  headers: { Authorization: `Bearer ${conn.access_token}`, "Xero-tenant-id": conn.tenant_id, Accept: "application/json" },
});
const data = await res.json();
if (!res.ok) { console.error("Accounts fetch failed:", res.status, JSON.stringify(data).slice(0, 300)); process.exit(1); }

for (const a of data.Accounts ?? []) {
  console.log(`${(a.Code ?? "?").padEnd(6)} ${a.Name.padEnd(40)} status=${a.Status}  bankAcctNo=${a.BankAccountNumber ?? "?"}  currency=${a.CurrencyCode ?? "?"}`);
}
