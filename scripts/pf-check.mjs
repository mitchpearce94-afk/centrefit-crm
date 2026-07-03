// Read-only: dump every ACCREC RI on any contact whose name mentions Purple / Druitt.
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const env = Object.fromEntries(
  readFileSync(new URL("../.env.gc-probe", import.meta.url), "utf8")
    .split("\n").filter((l) => l.includes("="))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, "").replace(/\\r|\\n/g, "").trim()]; }),
);
const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const { data: conn } = await supabase.from("xero_connections").select("tenant_id, access_token").order("updated_at", { ascending: false }).limit(1).single();
const XH = { Authorization: `Bearer ${conn.access_token}`, "Xero-tenant-id": conn.tenant_id, Accept: "application/json" };
const xd = (ms) => { const m = /\/Date\((\d+)/.exec(ms ?? ""); return m ? new Date(Number(m[1])).toISOString().slice(0, 10) : "?"; };

const ris = ((await (await fetch("https://api.xero.com/api.xro/2.0/RepeatingInvoices", { headers: XH })).json()).RepeatingInvoices ?? []).filter((r) => r.Type === "ACCREC");
for (const r of ris) {
  const n = r.Contact?.Name ?? "";
  if (/purple|druitt/i.test(n)) {
    console.log(`${n.padEnd(32)} | ${r.Status.padEnd(10)} | $${String(r.Total).padStart(8)} | ${r.Schedule?.Period}x${r.Schedule?.Unit} | next ${xd(r.Schedule?.NextScheduledDate)} | ${r.RepeatingInvoiceID}`);
    for (const li of r.LineItems ?? []) console.log(`    · ${(li.Description ?? "").slice(0, 60)}`);
  }
}
