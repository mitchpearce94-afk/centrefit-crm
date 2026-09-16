// 2026-09-16 — one-off: fill invoices.xero_contact_id / bill_to_name for
// every open (draft / authorised) Xero-linked invoice from Xero, so the new
// "Billed to" line shows a name straight away instead of "not synced".
// Paid / void invoices are left to Refresh on demand. ~1 Xero call per
// invoice, paced to stay well inside the 60/min limit.
//   npx tsx scripts/backfill-bill-to.mts [--dry]
import { readFileSync } from "node:fs";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { getAuthedClient } from "@/lib/xero/client";
import { fetchXeroInvoice } from "@/lib/xero/invoices";

for (const f of [".env.local", ".env.gc-probe"]) {
  try {
    for (const raw of readFileSync(new URL(`../${f}`, import.meta.url), "utf8").split("\n")) {
      const line = raw.trim(); const i = line.indexOf("="); if (i < 1 || line.startsWith("#")) continue;
      const k = line.slice(0, i).trim(); const v = line.slice(i + 1).trim().replace(/^"|"$/g, "").replace(/\\r|\\n/g, "").trim();
      if (!process.env[k]) process.env[k] = v;
    }
  } catch { /* optional */ }
}
const DRY = process.argv.includes("--dry");
const supabase = createServiceRoleClient();
const { client, conn } = await getAuthedClient(supabase as never);
const { data: rows, error } = await supabase
  .from("invoices")
  .select("id, xero_invoice_number, xero_invoice_id, status, bill_to_name")
  .in("status", ["draft", "authorised"])
  .not("xero_invoice_id", "is", null)
  .is("bill_to_name", null)
  .order("created_at", { ascending: false });
if (error) throw error;
console.log(`${rows?.length ?? 0} open invoices without a bill-to snapshot${DRY ? " (dry run)" : ""}`);
let done = 0, failed = 0;
for (const r of rows ?? []) {
  try {
    const x = await fetchXeroInvoice(client, conn.tenant_id, r.xero_invoice_id!);
    if (!DRY) {
      const { error: e } = await supabase.from("invoices").update({ xero_contact_id: x.contactID, bill_to_name: x.contactName }).eq("id", r.id);
      if (e) throw e;
    }
    done++;
    console.log(`  ${r.xero_invoice_number ?? r.id.slice(0, 8)} → ${x.contactName ?? "?"}`);
  } catch (e) {
    failed++;
    console.log(`  ${r.xero_invoice_number ?? r.id.slice(0, 8)} FAILED: ${(e as Error).message}`);
  }
  await new Promise((res) => setTimeout(res, 1200));
}
console.log(`done ${done}, failed ${failed}`);
