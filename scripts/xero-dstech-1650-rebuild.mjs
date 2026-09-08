// WRITE: Amanda's $16.50 DSTECH payment (e270305c, inside her $33 batch d7bbfea2)
// is invisible in Mitchell's Find & Match search. Delete it and recreate a clean
// standalone $16.50 payment on INT238173 with the rebuild reference.
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const OLD_PAYMENT = "e270305c-0000-0000-0000-000000000000"; // placeholder — resolved live below
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

// Resolve the live payment on INT238173 (must be exactly one, $16.50, unreconciled)
const inv = (await xero("GET", `Invoices/${INT238173}`)).data?.Invoices?.[0];
const pays = (inv?.Payments ?? []);
if (inv?.Status !== "PAID" || pays.length !== 1 || pays[0].Amount !== 16.5) {
  console.error(`ABORT: unexpected state on INT238173: status=${inv?.Status} payments=${pays.length} amt=${pays[0]?.Amount}`);
  process.exit(1);
}
const payId = pays[0].PaymentID;
const full = (await xero("GET", `Payments/${payId}`)).data?.Payments?.[0];
if (full?.IsReconciled) {
  console.error("ABORT: that payment is already reconciled — do not touch. Mitchell may have matched it.");
  process.exit(1);
}
console.log(`deleting old payment ${payId} (status=${full?.Status}, rec=${full?.IsReconciled})...`);
const del = await xero("POST", `Payments/${payId}`, { Status: "DELETED" });
if (!del.ok) { console.error("delete failed", del.status, del.text.slice(0, 600)); process.exit(1); }
console.log(`  deleted -> ${del.data.Payments?.[0]?.Status}`);

const mk = await xero("PUT", "Payments", {
  Payments: [{
    Invoice: { InvoiceID: INT238173 },
    Account: { AccountID: ANZ_602 },
    Date: "2026-06-30",
    Amount: 16.5,
    Reference: "ANZ multi-pay 600855 rebuild",
  }],
});
if (!mk.ok) { console.error("recreate failed", mk.status, mk.text.slice(0, 600)); process.exit(1); }
console.log(`recreated: $16.50 on INT238173  id=${mk.data.Payments?.[0]?.PaymentID}  status=${mk.data.Payments?.[0]?.Status}`);

const chk = (await xero("GET", `Invoices/${INT238173}`)).data?.Invoices?.[0];
console.log(`INT238173 now: status=${chk?.Status}  due=${chk?.AmountDue}`);
