// READ-ONLY: all money-in around 17-23 Apr 2026 (payments + receive money)
// vs ANZ raw receipts — find what the Oxenford $85.25 line is reconciled to.
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

console.log("=== XERO money-in payments 17-23 Apr (602), with reconcile state ===");
const where = encodeURIComponent('Status=="AUTHORISED" AND PaymentType=="ACCRECPAYMENT" AND Date>=DateTime(2026,04,17) AND Date<=DateTime(2026,04,23)');
const pays = await xeroGet(`Payments?where=${where}&order=Date`);
for (const p of pays?.Payments ?? []) {
  if (p.Account?.Code && p.Account.Code !== "602") continue;
  console.log(`${pd(p.Date)}  ${String(p.Amount).padStart(8)}  rec=${p.IsReconciled ? "Y" : "N"}  ${(p.Invoice?.Contact?.Name ?? "?").slice(0, 42).padEnd(44)} ${p.Invoice?.InvoiceNumber ?? ""}`);
}

console.log("");
console.log("=== XERO receive money 17-23 Apr (602) ===");
const whereB = encodeURIComponent('BankAccount.Code=="602" AND Status=="AUTHORISED" AND Type=="RECEIVE" AND Date>=DateTime(2026,04,17) AND Date<=DateTime(2026,04,23)');
const bt = await xeroGet(`BankTransactions?where=${whereB}`);
for (const t of bt?.BankTransactions ?? []) {
  console.log(`${pd(t.Date)}  ${String(t.Total).padStart(8)}  rec=${t.IsReconciled ? "Y" : "N"}  ${(t.Contact?.Name ?? "?").slice(0, 42)}`);
}

console.log("");
console.log("=== ANZ actual receipts 17-23 Apr ===");
const anz = readFileSync("C:/Users/mitch/Downloads/ANZ (1).csv", "utf8")
  .split(/\r?\n/).filter((l) => l.trim())
  .map((l) => {
    const m = /^(\d{2})\/(\d{2})\/(\d{4}),"(-?[\d.]+)",(.*)$/.exec(l);
    return m ? { iso: `${m[3]}-${m[2]}-${m[1]}`, amount: Number(m[4]), desc: m[5] } : null;
  }).filter(Boolean)
  .filter((l) => l.amount > 0 && l.iso >= "2026-04-17" && l.iso <= "2026-04-23");
for (const l of anz.sort((a, b) => a.iso.localeCompare(b.iso))) {
  console.log(`${l.iso}  ${String(l.amount).padStart(8)}  ${l.desc.slice(0, 70)}`);
}
