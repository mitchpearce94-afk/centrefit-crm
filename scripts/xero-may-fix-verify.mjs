// READ-ONLY: verify the May batch fix — expect a new reconciled batch of
// $29,376.94 (9 payments), the old $31,349.45 batch payments DELETED, and the
// two never-paid bills (Leader Q-SI-4455690, Transport Direct $67.31) back to
// AUTHORISED/awaiting payment.
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
  .select("id, tenant_id, access_token, refresh_token, expires_at")
  .order("updated_at", { ascending: false })
  .limit(1)
  .single();
if (error || !conn) { console.error("No Xero connection:", error?.message); process.exit(1); }

let accessToken = conn.access_token;
if (!conn.expires_at || new Date(conn.expires_at).getTime() < Date.now() + 60_000) {
  const res = await fetch("https://identity.xero.com/connect/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: "Basic " + Buffer.from(`${env.XERO_CLIENT_ID}:${env.XERO_CLIENT_SECRET}`).toString("base64"),
    },
    body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: conn.refresh_token }),
  });
  const tok = await res.json();
  if (!res.ok) { console.error("Token refresh failed:", JSON.stringify(tok)); process.exit(1); }
  accessToken = tok.access_token;
  await supabase.from("xero_connections").update({
    access_token: tok.access_token,
    refresh_token: tok.refresh_token ?? conn.refresh_token,
    expires_at: new Date(Date.now() + (tok.expires_in ?? 1800) * 1000).toISOString(),
    updated_at: new Date().toISOString(),
  }).eq("id", conn.id);
}

const xeroGet = async (path) => {
  const res = await fetch(`https://api.xero.com/api.xro/2.0/${path}`, {
    headers: { Authorization: `Bearer ${accessToken}`, "Xero-tenant-id": conn.tenant_id, Accept: "application/json" },
  });
  const data = await res.json();
  if (!res.ok) { console.error(`${path} failed:`, res.status, JSON.stringify(data).slice(0, 300)); process.exit(1); }
  return data;
};

const px = (d) => { const m = /\/Date\((\d+)/.exec(d || ""); return m ? new Date(Number(m[1])).toISOString().slice(0, 10) : String(d).slice(0, 10); };
const money = (n) => Number(n).toLocaleString("en-AU", { style: "currency", currency: "AUD" });

// 1. Re-pull May payments
const all = [];
for (let page = 1; ; page++) {
  const where = encodeURIComponent("Date>=DateTime(2026,05,01) AND Date<DateTime(2026,06,01)");
  const data = await xeroGet(`Payments?where=${where}&order=Date&page=${page}`);
  const batch = data.Payments ?? [];
  all.push(...batch);
  if (batch.length < 100) break;
}

const oldBatch = all.filter((p) => p.BatchPayment && Math.abs(Number(p.BatchPayment.TotalAmount) - 31349.45) < 0.01 && p.Status === "AUTHORISED");
console.log(`Old $31,349.45 batch — live payments remaining: ${oldBatch.length} (want 0)`);

const newBatchIds = [...new Set(all.filter((p) => p.BatchPayment && Math.abs(Number(p.BatchPayment.TotalAmount) - 29376.94) < 0.01).map((p) => p.BatchPayment.BatchPaymentID))];
for (const id of newBatchIds) {
  const ps = all.filter((p) => p.BatchPayment?.BatchPaymentID === id && p.Status === "AUTHORISED");
  const rec = ps.filter((p) => p.IsReconciled === true);
  console.log(`New batch ${id.slice(0, 8)}: ${ps.length} live payments = ${money(ps.reduce((s, p) => s + p.Amount, 0))}, reconciled: ${rec.length}/${ps.length}`);
  for (const p of ps) console.log(`   ${p.IsReconciled ? "REC" : "UNR"}  ${px(p.Date)}  ${String(p.Amount).padStart(10)}  ${(p.Invoice?.InvoiceNumber ?? "?").padEnd(16)} ${(p.Invoice?.Contact?.Name ?? "?").slice(0, 40)}`);
}
if (!newBatchIds.length) console.log("New $29,376.94 batch: NOT FOUND");

// 2. The two never-paid bills — get InvoiceIDs from the old raw dump
const oldRaw = JSON.parse(readFileSync(new URL("./xero-may-raw.json", import.meta.url), "utf8"));
const targets = [];
for (const p of oldRaw) {
  if (p.Invoice?.InvoiceNumber === "Q-SI-4455690" && p.Invoice?.InvoiceID) targets.push(p.Invoice.InvoiceID);
  if (Math.abs(p.Amount - 67.31) < 0.01 && p.Invoice?.Contact?.Name?.includes("Transport") && p.Invoice?.InvoiceID) targets.push(p.Invoice.InvoiceID);
}
const uniq = [...new Set(targets)];
console.log("");
console.log("=== The two bills that were never really paid ===");
for (const id of uniq) {
  const data = await xeroGet(`Invoices/${id}`);
  const inv = data.Invoices?.[0];
  if (!inv) continue;
  console.log(`${inv.InvoiceNumber ?? "(no number)"} | ${inv.Contact?.Name?.slice(0, 40)} | status=${inv.Status} | total=${inv.Total} | due=${inv.AmountDue}  (want status=AUTHORISED, due=full)`);
}
