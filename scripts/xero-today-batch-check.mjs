// READ-ONLY: check today's payments for the rebuilt $29,376.94 batch and its
// reconciliation state.
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

const res = await fetch(`https://api.xero.com/api.xro/2.0/Payments?where=${encodeURIComponent("Date>=DateTime(2026,08,12)")}&order=Date`, {
  headers: { Authorization: `Bearer ${conn.access_token}`, "Xero-tenant-id": conn.tenant_id, Accept: "application/json" },
});
const data = await res.json();
if (!res.ok) { console.error("Payments fetch failed:", res.status, JSON.stringify(data).slice(0, 300)); process.exit(1); }

const px = (d) => { const m = /\/Date\((\d+)/.exec(d || ""); return m ? new Date(Number(m[1])).toISOString().slice(0, 10) : String(d).slice(0, 10); };
for (const p of (data.Payments ?? []).filter((p) => p.Status === "AUTHORISED")) {
  const b = p.BatchPayment ? `batch=${Number(p.BatchPayment.TotalAmount)} bstat=${p.BatchPayment.Status ?? "?"} brec=${p.BatchPayment.IsReconciled ?? "?"}` : "no-batch";
  console.log(`${px(p.Date)}  ${String(p.Amount).padStart(10)}  rec=${p.IsReconciled}  ${(p.Invoice?.InvoiceNumber ?? "?").padEnd(16)} ${(p.Invoice?.Contact?.Name ?? "?").slice(0, 35).padEnd(37)} ${b}`);
}
