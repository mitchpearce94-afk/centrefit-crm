// READ-ONLY: reconstruct May 2026 batch payments — hunting the accountant's
// "15 May 2026 | Batch Payment | 31,349.45 | User | Reconciled" line.
import { readFileSync, writeFileSync } from "node:fs";
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
const sum = (a) => a.reduce((s, p) => s + (p.Amount ?? 0), 0);

const all = [];
for (let page = 1; ; page++) {
  const where = encodeURIComponent("Date>=DateTime(2026,05,01) AND Date<DateTime(2026,06,01)");
  const data = await xeroGet(`Payments?where=${where}&order=Date&page=${page}`);
  const batch = data.Payments ?? [];
  all.push(...batch);
  if (batch.length < 100) break;
}
writeFileSync(new URL("./xero-may-raw.json", import.meta.url), JSON.stringify(all, null, 2));
console.log(`May payments (all statuses): ${all.length}\n`);

const ids = [...new Set(all.filter((p) => p.BatchPayment).map((p) => p.BatchPayment.BatchPaymentID))];
console.log("=== All May batches ===");
for (const id of ids.sort((a, b) => {
  const pa = all.find((p) => p.BatchPayment?.BatchPaymentID === a), pb = all.find((p) => p.BatchPayment?.BatchPaymentID === b);
  return px(pa.BatchPayment.Date).localeCompare(px(pb.BatchPayment.Date));
})) {
  const ps = all.filter((p) => p.BatchPayment?.BatchPaymentID === id);
  const auth = ps.filter((p) => p.Status === "AUTHORISED");
  const unrec = auth.filter((p) => !p.IsReconciled);
  const meta = ps[0].BatchPayment;
  const flag = Math.abs(Number(meta.TotalAmount) - 31349.45) < 0.01 ? "  <<<< THE 31,349.45 BATCH" : "";
  console.log(`${px(meta.Date)}  declared=${money(meta.TotalAmount).padStart(12)}  liveSum=${money(sum(auth)).padStart(12)}  n=${String(auth.length).padStart(2)}  unrec=${unrec.length}${flag}`);
  if (flag) {
    for (const p of ps) console.log(`     ${p.Status === "DELETED" ? "DEL" : p.IsReconciled ? "REC" : "UNR"}  ${px(p.Date)}  ${String(p.Amount).padStart(10)}  ${(p.Invoice?.InvoiceNumber ?? "?").padEnd(16)} ${(p.Invoice?.Contact?.Name ?? "?").slice(0, 40)}`);
  }
}

const dels = all.filter((p) => p.Status === "DELETED");
console.log(`\n=== DELETED May payments (batch link is lost on delete): ${dels.length} ===`);
for (const p of dels.sort((a, b) => px(a.Date).localeCompare(px(b.Date)))) {
  console.log(`  ${px(p.Date)}  ${String(p.Amount).padStart(10)}  ${(p.Invoice?.InvoiceNumber ?? "?").padEnd(16)} ${(p.Invoice?.Contact?.Name ?? "?").slice(0, 40)}`);
}

const unrecMay = all.filter((p) => p.Status === "AUTHORISED" && !p.IsReconciled);
console.log(`\n=== Unreconciled AUTHORISED May payments: ${unrecMay.length} = ${money(sum(unrecMay))} ===`);
for (const p of unrecMay) {
  console.log(`  ${px(p.Date)}  ${String(p.Amount).padStart(10)}  ${(p.Invoice?.InvoiceNumber ?? "?").padEnd(16)} ${(p.Invoice?.Contact?.Name ?? "?").slice(0, 40)}  ${p.BatchPayment ? "batch " + p.BatchPayment.BatchPaymentID.slice(0, 8) : ""}`);
}
