// READ-ONLY: check the 9 really-paid May bills directly — status, amount due,
// and their current payments (with reconciled flag).
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

const xeroGet = async (path) => {
  const res = await fetch(`https://api.xero.com/api.xro/2.0/${path}`, {
    headers: { Authorization: `Bearer ${conn.access_token}`, "Xero-tenant-id": conn.tenant_id, Accept: "application/json" },
  });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = null; }
  if (!res.ok || !data) { console.error(`  !! ${path} failed: ${res.status} ${text.slice(0, 120)}`); return null; }
  return data;
};

const px = (d) => { const m = /\/Date\((\d+)/.exec(d || ""); return m ? new Date(Number(m[1])).toISOString().slice(0, 10) : String(d).slice(0, 10); };

// InvoiceIDs of the 9 really-paid bills, from the old raw dump (the REC
// payments inside the 31,349.45 batch, minus Q-SI-4455690 and TD 67.31).
const oldRaw = JSON.parse(readFileSync(new URL("./xero-may-raw.json", import.meta.url), "utf8"));
const batchPays = oldRaw.filter((p) => p.BatchPayment && Math.abs(Number(p.BatchPayment.TotalAmount) - 31349.45) < 0.01 && p.Status === "AUTHORISED");
const nine = batchPays.filter((p) => p.Invoice?.InvoiceNumber !== "Q-SI-4455690" && Math.abs(p.Amount - 67.31) > 0.01);
console.log(`Checking ${nine.length} bills (want 9):\n`);

let totalPaid = 0, allRec = true;
for (const bp of nine) {
  if (!bp.Invoice?.InvoiceID) { console.log(`(no InvoiceID on payment $${bp.Amount} ${bp.Invoice?.Contact?.Name ?? "?"} — skipping fetch)`); continue; }
  const inv = (await xeroGet(`Invoices/${bp.Invoice.InvoiceID}`))?.Invoices?.[0];
  if (!inv) continue;
  const pays = inv?.Payments ?? [];
  let line = `${(inv.InvoiceNumber ?? "?").padEnd(16)} ${inv.Contact?.Name?.slice(0, 32).padEnd(34)} status=${inv.Status.padEnd(11)} due=${String(inv.AmountDue).padStart(9)}`;
  for (const p of pays) {
    const detail = (await xeroGet(`Payments/${p.PaymentID}`))?.Payments?.[0];
    const rec = detail?.IsReconciled;
    const inBatch = detail?.BatchPayment ? ` batch=${Number(detail.BatchPayment.TotalAmount)}` : "";
    line += `  | pay ${px(p.Date)} $${p.Amount} rec=${rec}${inBatch}`;
    if (detail?.Status === "AUTHORISED") { totalPaid += p.Amount; if (!rec) allRec = false; }
  }
  if (!pays.length) { line += "  | NO PAYMENT"; allRec = false; }
  console.log(line);
}
console.log(`\nTotal live payments across the 9: $${totalPaid.toFixed(2)} (want 29376.94), all reconciled: ${allRec}`);
