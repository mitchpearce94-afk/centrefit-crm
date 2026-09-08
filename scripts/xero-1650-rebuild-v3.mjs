// WRITE v3: delete Amanda's whole $33 batch (only live content = the 16.50 payment;
// Xero forbids deleting payments inside a batch individually), then recreate the
// 16.50 standalone with the rebuild reference.
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const BATCH = "d7bbfea2-475b-485b-89d1-a5a169607cb5";
const REAL_PAYMENT = "e270305c-e27d-40da-adbc-97b1a0085162";
const INT238173 = "fd050393-20d1-4619-beca-2b1fbb21dd8b";
const ANZ_602 = "69ea74f1-ef5d-4879-8cfc-d97762af6308";

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
  const res = await fetch(`https://api.xero.com/api.xro/2.0/${path}?summarizeErrors=false`, {
    method,
    headers: { ...hdrs, ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data = null; try { data = JSON.parse(text); } catch {}
  return { ok: res.ok, status: res.status, data, text };
};
const firstErr = (el) => (el?.ValidationErrors ?? []).map((e) => e.Message).join("; ");

// Guard: batch must be unreconciled and its only live payment the 16.50
const bp = (await xero("GET", `BatchPayments/${BATCH}`)).data?.BatchPayments?.[0];
if (!bp || bp.Status !== "AUTHORISED" || bp.IsReconciled) {
  console.error(`ABORT: batch state=${bp?.Status} rec=${bp?.IsReconciled}`); process.exit(1);
}
const live = [];
for (const p of bp.Payments ?? []) {
  const fp = (await xero("GET", `Payments/${p.PaymentID}`)).data?.Payments?.[0];
  if (fp && fp.Status === "AUTHORISED") live.push(fp);
}
if (live.length !== 1 || live[0].PaymentID !== REAL_PAYMENT || live[0].IsReconciled) {
  console.error(`ABORT: expected exactly the one live unreconciled 16.50; got ${live.length}`); process.exit(1);
}
console.log("guard OK: batch unreconciled, one live 16.50 payment inside");

// Delete the batch
const del = await xero("POST", "BatchPayments", { BatchPayments: [{ BatchPaymentID: BATCH, Status: "DELETED" }] });
const delEl = del.data?.BatchPayments?.[0];
if (!del.ok || firstErr(delEl)) { console.error("batch delete FAILED:", del.status, firstErr(delEl) || del.text.slice(0, 400)); process.exit(1); }
console.log(`batch delete response status=${delEl?.Status}`);

// Confirm: payment gone, bill reopened
const gone = (await xero("GET", `Payments/${REAL_PAYMENT}`)).data?.Payments?.[0];
const invMid = (await xero("GET", `Invoices/${INT238173}`)).data?.Invoices?.[0];
console.log(`payment now=${gone?.Status}  bill now=${invMid?.Status} due=${invMid?.AmountDue}`);
if (gone?.Status !== "DELETED" || invMid?.AmountDue !== 16.5) { console.error("ABORT: unexpected post-delete state"); process.exit(1); }

// Recreate standalone with reference
const mk = await xero("PUT", "Payments", {
  Payments: [{
    Invoice: { InvoiceID: INT238173 },
    Account: { AccountID: ANZ_602 },
    Date: "2026-06-30",
    Amount: 16.5,
    Reference: "ANZ multi-pay 600855 rebuild",
  }],
});
const mkEl = mk.data?.Payments?.[0];
if (!mk.ok || !mkEl?.PaymentID || firstErr(mkEl)) { console.error("recreate FAILED:", mk.status, firstErr(mkEl) || mk.text.slice(0, 400)); process.exit(1); }
console.log(`recreated: id=${mkEl.PaymentID}  status=${mkEl.Status}`);

// Final verify
const inv = (await xero("GET", `Invoices/${INT238173}`)).data?.Invoices?.[0];
console.log(`INT238173: status=${inv?.Status}  due=${inv?.AmountDue}`);
const pays = (await xero("GET", `Payments?where=${encodeURIComponent('Status=="AUTHORISED" AND Date==DateTime(2026,06,30)')}`)).data?.Payments ?? [];
const mine = pays.filter((x) => (x.Reference ?? "").includes("600855"));
const sum = mine.reduce((s, x) => s + x.Amount, 0);
console.log(`payments with 600855 ref: ${mine.length}, sum=${sum.toFixed(2)}  + overpayments 14,130.67 + 41.25 = ${(sum + 14130.67 + 41.25).toFixed(2)} (target 59053.52)`);
