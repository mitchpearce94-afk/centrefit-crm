// READ-ONLY: verify state after the 16.50 delete/recreate.
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const INT238173 = "fd050393-20d1-4619-beca-2b1fbb21dd8b";

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

const hdrs = { Authorization: `Bearer ${conn.access_token}`, "Xero-tenant-id": conn.tenant_id, Accept: "application/json" };
const get = async (path) => {
  const res = await fetch(`https://api.xero.com/api.xro/2.0/${path}`, { headers: hdrs });
  const text = await res.text();
  let data = null; try { data = JSON.parse(text); } catch {}
  return { ok: res.ok, status: res.status, data };
};

console.log("=== INT238173 payments ===");
const inv = (await get(`Invoices/${INT238173}`)).data?.Invoices?.[0];
console.log(`bill status=${inv?.Status}  due=${inv?.AmountDue}  paid=${inv?.AmountPaid}`);
for (const p of inv?.Payments ?? []) {
  const fp = (await get(`Payments/${p.PaymentID}`)).data?.Payments?.[0];
  console.log(`  PaymentID=${p.PaymentID}  amt=${p.Amount}  fullStatus=${fp?.Status}  rec=${fp?.IsReconciled}  ref=${fp?.Reference ?? p.Reference ?? ""}  batch=${fp?.BatchPayment?.BatchPaymentID ?? "-"}`);
}

console.log("\n=== old payment e270305c ===");
const old = await get("Payments/e270305c-38ad-4a19-affa-57638e6a48d4");
console.log(old.ok ? `status=${old.data.Payments?.[0]?.Status}` : `GET ${old.status} (id guess may be wrong — see batch below)`);

console.log("\n=== Amanda's batch d7bbfea2 ===");
const bp = (await get("BatchPayments/d7bbfea2-475b-485b-89d1-a5a169607cb5")).data?.BatchPayments?.[0];
console.log(`status=${bp?.Status}  total=${bp?.TotalAmount}  payments=${(bp?.Payments ?? []).length}`);
for (const p of bp?.Payments ?? []) console.log(`  ${p.PaymentID}  ${p.Amount}`);

console.log("\n=== live rebuild pieces (payments ref search) ===");
const pays = (await get(`Payments?where=${encodeURIComponent('Status=="AUTHORISED" AND Date==DateTime(2026,06,30)')}`)).data?.Payments ?? [];
let sum = 0;
for (const p of pays.filter((p) => (p.Reference ?? "").includes("600855"))) {
  sum += p.Amount;
  console.log(`  ${String(p.Amount).padStart(10)}  ${(p.Invoice?.InvoiceNumber ?? "?").padEnd(14)} ${(p.Invoice?.Contact?.Name ?? "?").slice(0, 35)}  rec=${p.IsReconciled}`);
}
console.log(`payments sum=${sum.toFixed(2)}  + overpayments 14130.67 + 41.25 = ${(sum + 14130.67 + 41.25).toFixed(2)}  (target 59053.52)`);
