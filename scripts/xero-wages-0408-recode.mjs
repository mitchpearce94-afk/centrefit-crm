// WRITE: recode the 4 Aug 2026 wages spend money $6,336.10 from 341 (IT Parts,
// GST INPUT) to 804 Wages Payable BASEXCLUDED — matches every other weekly wages line.
// Also READ-ONLY: try the Journals endpoint to confirm pay-run journals credit 804.
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

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

const hdrs = { Authorization: `Bearer ${accessToken}`, "Xero-tenant-id": conn.tenant_id, Accept: "application/json" };
const xero = async (method, path, body) => {
  const res = await fetch(`https://api.xero.com/api.xro/2.0/${path}${path.includes("?") ? "&" : "?"}summarizeErrors=false`, {
    method,
    headers: { ...hdrs, ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data = null; try { data = JSON.parse(text); } catch {}
  return { ok: res.ok, status: res.status, data, text };
};
const firstErr = (el) => (el?.ValidationErrors ?? []).map((e) => e.Message).join("; ");

// Find the 4 Aug wages spend money
const q = await xero("GET", `BankTransactions?where=${encodeURIComponent('Type=="SPEND" AND Date==DateTime(2026,08,04) AND Total==6336.10')}`);
const cands = (q.data?.BankTransactions ?? []).filter((t) => t.Status !== "DELETED" && t.Contact?.Name === "CentreFit");
if (cands.length !== 1) { console.error(`ABORT: expected exactly 1 candidate, got ${cands.length}`); process.exit(1); }
const id = cands[0].BankTransactionID;
const full = (await xero("GET", `BankTransactions/${id}`)).data?.BankTransactions?.[0];
const li = full?.LineItems?.[0];
console.log(`target: ${id}  rec=${full.IsReconciled}  line acct=${li?.AccountCode} tax=${li?.TaxType} amt=${li?.LineAmount}`);
if (String(li?.AccountCode) !== "341") { console.error("ABORT: line is not coded 341 — state changed"); process.exit(1); }

const upd = await xero("POST", `BankTransactions`, {
  BankTransactions: [{
    BankTransactionID: id,
    LineItems: [{
      Description: "Wages weekly batch (recoded from 341 IT Parts — was miscoded 4 Aug)",
      Quantity: 1,
      UnitAmount: 6336.1,
      AccountCode: "804",
      TaxType: "BASEXCLUDED",
    }],
  }],
});
const el = upd.data?.BankTransactions?.[0];
if (!upd.ok || firstErr(el)) { console.error("update FAILED:", upd.status, firstErr(el) || upd.text.slice(0, 500)); process.exit(1); }

const chk = (await xero("GET", `BankTransactions/${id}`)).data?.BankTransactions?.[0];
const cli = chk?.LineItems?.[0];
console.log(`recoded: acct=${cli?.AccountCode}  tax=${cli?.TaxType}  total=${chk?.Total}  rec=${chk?.IsReconciled}  status=${chk?.Status}`);

// Bonus read-only: do pay-run journals credit 804? (may 403 if scope missing)
console.log("\n=== Journals probe (pay-run check) ===");
const j = await xero("GET", "Journals?offset=0");
if (!j.ok) {
  console.log(`Journals endpoint not accessible (${j.status}) — accountant to confirm pay-run journals hit 804.`);
} else {
  const payruns = (j.data?.Journals ?? []).filter((x) => x.SourceType === "PAYSLIP" || /pay ?run/i.test(x.Reference ?? ""));
  console.log(`journals page 1: ${j.data?.Journals?.length ?? 0}, pay-run-ish: ${payruns.length}`);
  for (const x of payruns.slice(0, 3)) {
    for (const l of x.JournalLines ?? []) console.log(`  ${x.JournalDate?.slice?.(0, 10) ?? ""} ${l.AccountCode} ${l.AccountName}  ${l.NetAmount}`);
  }
}
