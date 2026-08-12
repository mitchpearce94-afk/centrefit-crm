// READ-ONLY forensics: reconstruct ALL batch payments since 2026-06-01,
// including DELETED payments, to find the $31,349.45 batch Mitchell described
// (one invoice deleted -> $29,376.94 remainder) and see what actually got
// reconciled vs not.
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

const { data: conn } = await supabase
  .from("xero_connections")
  .select("id, tenant_id, access_token, refresh_token, expires_at")
  .order("updated_at", { ascending: false })
  .limit(1)
  .single();

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
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Xero-tenant-id": conn.tenant_id,
      Accept: "application/json",
    },
  });
  const data = await res.json();
  if (!res.ok) { console.error(`${path} failed:`, res.status, JSON.stringify(data).slice(0, 400)); process.exit(1); }
  return data;
};

const parseXeroDate = (d) => {
  if (!d) return null;
  const m = /\/Date\((\d+)/.exec(d);
  return m ? new Date(Number(m[1])).toISOString().slice(0, 10) : String(d).slice(0, 10);
};
const money = (n) => Number(n).toLocaleString("en-AU", { style: "currency", currency: "AUD" });

// No status filter — pulls AUTHORISED and DELETED alike.
const all = [];
for (let page = 1; ; page++) {
  const where = encodeURIComponent("Date>=DateTime(2026,06,01)");
  const data = await xeroGet(`Payments?where=${where}&order=Date&page=${page}`);
  const batch = data.Payments ?? [];
  all.push(...batch);
  if (batch.length < 100) break;
}
writeFileSync(new URL("./xero-forensics-raw.json", import.meta.url), JSON.stringify(all, null, 2));

const batches = {};
for (const p of all) {
  const id = p.BatchPayment?.BatchPaymentID;
  if (id) (batches[id] ??= { meta: p.BatchPayment, payments: [] }).payments.push(p);
}

console.log(`Payments since 2026-06-01 (all statuses): ${all.length}`);
console.log(`Distinct batches: ${Object.keys(batches).length}\n`);

const sum = (arr) => arr.reduce((s, p) => s + (p.Amount ?? 0), 0);

for (const [id, { meta, payments }] of Object.entries(batches).sort((a, b) =>
  (parseXeroDate(a[1].meta.Date) ?? "").localeCompare(parseXeroDate(b[1].meta.Date) ?? ""))) {
  const auth = payments.filter((p) => p.Status === "AUTHORISED");
  const del = payments.filter((p) => p.Status === "DELETED");
  const rec = auth.filter((p) => p.IsReconciled === true);
  const unrec = auth.filter((p) => p.IsReconciled === false);
  const flag = Number(meta.TotalAmount) === 31349.45 || Math.abs(sum(auth) - 29376.94) < 0.01 ? "  <<<< THE ONE MITCHELL DESCRIBED?" : "";
  console.log(`Batch ${parseXeroDate(meta.Date)}  declared total=${meta.TotalAmount != null ? money(meta.TotalAmount) : "?"}  batchStatus=${meta.Status ?? "?"}${flag}`);
  console.log(`  live payments:    ${String(auth.length).padStart(2)} = ${money(sum(auth))}   (reconciled ${rec.length} = ${money(sum(rec))} | UNreconciled ${unrec.length} = ${money(sum(unrec))})`);
  if (del.length) console.log(`  DELETED payments: ${String(del.length).padStart(2)} = ${money(sum(del))}`);
  for (const p of payments) {
    console.log(`    ${p.Status === "DELETED" ? "DEL" : p.IsReconciled ? "REC" : "UNR"}  ${parseXeroDate(p.Date)}  ${money(p.Amount).padStart(12)}  ${(p.Invoice?.InvoiceNumber ?? "?").padEnd(16)} ${(p.Invoice?.Contact?.Name ?? "?").slice(0, 40)}`);
  }
  console.log("");
}
