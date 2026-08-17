// READ-ONLY: every bill numbered 449503, with each payment's bank account and
// reconcile state.
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
  const text = await res.text();
  let data = null; try { data = JSON.parse(text); } catch {}
  if (!res.ok) { console.error(`[WARN] ${path.split("?")[0]}:`, res.status, text.slice(0, 120)); return null; }
  return data;
};
const pd = (d) => { const m = /\/Date\((\d+)/.exec(d); return m ? new Date(Number(m[1])).toISOString().slice(0, 10) : String(d).slice(0, 10); };

const list = await xeroGet(`Invoices?where=${encodeURIComponent('InvoiceNumber=="449503" AND Type=="ACCPAY"')}`);
for (const inv of list?.Invoices ?? []) {
  console.log(`\nBILL 449503  contact="${inv.Contact?.Name}"  date=${String(inv.DateString ?? "").slice(0, 10)}  total=${inv.Total}  due=${inv.AmountDue}  status=${inv.Status}`);
  const full = await xeroGet(`Invoices/${inv.InvoiceID}`);
  const f = full?.Invoices?.[0];
  for (const p of f?.Payments ?? []) {
    const pay = (await xeroGet(`Payments/${p.PaymentID}`))?.Payments?.[0];
    console.log(`  payment ${pd(p.Date)}  ${p.Amount}  acct=${pay?.Account?.Code ?? "?"} ${pay?.Account?.Name ?? ""}  rec=${pay?.IsReconciled ? "Y" : "N"}  batch=${pay?.BatchPayment?.BatchPaymentID ? "Y" : "-"}  status=${pay?.Status}`);
  }
  for (const c of f?.CreditNotes ?? []) {
    console.log(`  credit note ${c.CreditNoteNumber ?? c.CreditNoteID}  applied=${c.AppliedAmount}  date=${pd(c.Date)}`);
  }
}
