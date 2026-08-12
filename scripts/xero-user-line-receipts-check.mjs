// READ-ONLY: fetch the customer invoices behind the accountant's User-source
// "Received" statement lines to see how they were actually paid (Stripe/GC ref
// = double-count risk; no ref = possibly cash/never received).
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

const px = (d) => { const m = /\/Date\((\d+)/.exec(d || ""); return m ? new Date(Number(m[1])).toISOString().slice(0, 10) : String(d).slice(0, 10); };

const res = await fetch("https://api.xero.com/api.xro/2.0/Invoices?InvoiceNumbers=INV-5018,INV-5227,INV-5228,INV-4699,INV-4060", {
  headers: { Authorization: `Bearer ${conn.access_token}`, "Xero-tenant-id": conn.tenant_id, Accept: "application/json" },
});
const data = await res.json();
if (!res.ok) { console.error("Invoices fetch failed:", res.status, JSON.stringify(data).slice(0, 300)); process.exit(1); }

for (const inv of data.Invoices ?? []) {
  console.log(`${inv.InvoiceNumber} | ${inv.Contact?.Name?.slice(0, 45)} | status=${inv.Status} total=${inv.Total} paid=${inv.AmountPaid} due=${inv.AmountDue}`);
  for (const p of inv.Payments ?? []) console.log(`   payment: ${px(p.Date)}  ${p.Amount}  ref=${p.Reference || "(none)"}`);
}
