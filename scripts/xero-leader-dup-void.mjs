// WRITE: void ONE of the two identical Leader V-SI-3800026 bills ($201.30, both
// unpaid, entered twice 17 Aug) per 25-Aug audit verdict. Keeps 5cadcf08, voids e5ab007d.
// Also READ-ONLY: compare the two SDA INV010901 bills line-by-line.
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const KEEP_LEADER = "5cadcf08-5734-4bf6-8d30-d9f8a517d3f6";
const VOID_LEADER = "e5ab007d-dc22-4582-9ba0-032ee4bdf3af";
const SDA_A = "9a64dbed-99d6-41a9-9bcd-0659e02c473c";
const SDA_B = "05b57d9f-0b44-4b78-9f2f-f0d33aeb1d4e";

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
  .select("id, tenant_id, access_token, refresh_token, expires_at")
  .order("updated_at", { ascending: false }).limit(1).single();

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
  if (!res.ok) { console.error("refresh failed", JSON.stringify(tok)); process.exit(1); }
  accessToken = tok.access_token;
  await supabase.from("xero_connections").update({
    access_token: tok.access_token,
    refresh_token: tok.refresh_token ?? conn.refresh_token,
    expires_at: new Date(Date.now() + (tok.expires_in ?? 1800) * 1000).toISOString(),
    updated_at: new Date().toISOString(),
  }).eq("id", conn.id);
}

const xero = async (method, path, body) => {
  const res = await fetch(`https://api.xero.com/api.xro/2.0/${path}?summarizeErrors=false`, {
    method,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Xero-tenant-id": conn.tenant_id,
      Accept: "application/json",
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data = null; try { data = JSON.parse(text); } catch {}
  return { ok: res.ok, status: res.status, data, text };
};
const money = (n) => Number(n).toLocaleString("en-AU", { style: "currency", currency: "AUD" });

// Guard: target must still be AUTHORISED, unpaid, $201.30
const chk = await xero("GET", `Invoices/${VOID_LEADER}`);
const b = chk.data?.Invoices?.[0];
if (!b || b.Status !== "AUTHORISED" || b.AmountPaid !== 0 || b.Total !== 201.3) {
  console.error(`ABORT: Leader void target state changed: status=${b?.Status} paid=${b?.AmountPaid} total=${b?.Total}`);
  process.exit(1);
}
const v = await xero("POST", `Invoices/${VOID_LEADER}`, { InvoiceID: VOID_LEADER, Status: "VOIDED" });
if (!v.ok) { console.error("void failed", v.status, v.text.slice(0, 800)); process.exit(1); }
console.log(`Leader V-SI-3800026 dup ${VOID_LEADER.slice(0, 8)} -> ${v.data.Invoices?.[0]?.Status}  (kept ${KEEP_LEADER.slice(0, 8)})`);

console.log("\n=== SDA INV010901 pair comparison (read-only) ===");
for (const id of [SDA_A, SDA_B]) {
  const r = await xero("GET", `Invoices/${id}`);
  const inv = r.data?.Invoices?.[0];
  console.log(`\n  id=${id.slice(0, 8)}  status=${inv?.Status}  date=${JSON.stringify(inv?.DateString ?? inv?.Date)}  total=${money(inv?.Total)}  ref=${inv?.Reference ?? ""}  createdVia=${inv?.SentToContact ?? ""}`);
  for (const li of inv?.LineItems ?? []) {
    console.log(`    ${money(li.LineAmount).padStart(10)}  qty=${li.Quantity}  ${String(li.Description ?? "").slice(0, 80)}`);
  }
  const hist = await xero("GET", `Invoices/${id}/History`);
  const first = (hist.data?.HistoryRecords ?? []).slice(-2);
  for (const h of first) console.log(`    hist: ${(h.User ?? "").padEnd(20)} [${h.Changes}] ${(h.Details ?? "").slice(0, 80)}`);
}
