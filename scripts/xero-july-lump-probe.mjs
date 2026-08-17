// READ-ONLY probe: what did the July lump feed lines get reconciled against?
// Lists ALL AUTHORISED bank transactions (spend/receive money) on 602 for
// May + July 2026 with reconciliation state, looking for duplicates of the
// batch amounts. Auth pattern as per xero-bank-rec-gap-audit.mjs.
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const env = Object.fromEntries(
  readFileSync(new URL("../.env.gc-probe", import.meta.url), "utf8")
    .split("\n").filter((l) => l.includes("="))
    .map((l) => {
      const i = l.indexOf("=");
      // Values may end with LITERAL backslash-n text (echo-baked vercel envs) — strip both forms.
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
  if (!res.ok) { console.error(`[WARN] ${path.split("?")[0]}:`, res.status, text.slice(0, 150)); return null; }
  return data;
};
const pd = (d) => { const m = /\/Date\((\d+)/.exec(d); return m ? new Date(Number(m[1])).toISOString().slice(0, 10) : String(d).slice(0, 10); };
const money = (n) => (n ?? 0).toLocaleString("en-AU", { style: "currency", currency: "AUD" });

for (const [label, from, to] of [
  ["May 2026", "DateTime(2026,05,01)", "DateTime(2026,05,31)"],
  ["Jul 2026", "DateTime(2026,07,01)", "DateTime(2026,07,25)"],
]) {
  console.log(`=== ALL bank transactions on 602, ${label} ===`);
  for (let page = 1; ; page++) {
    const where = encodeURIComponent(`BankAccount.Code=="602" AND Status=="AUTHORISED" AND Date>=${from} AND Date<=${to}`);
    const data = await xeroGet(`BankTransactions?where=${where}&order=Date&page=${page}`);
    if (!data) break;
    for (const t of data.BankTransactions ?? []) {
      console.log(`${pd(t.Date)}  ${String(t.Type).padEnd(16)} ${money(t.Total).padStart(13)}  rec=${t.IsReconciled ? "Y" : "N"}  ${(t.Contact?.Name ?? "?").slice(0, 40)}  ref=${(t.Reference ?? "").slice(0, 30)}`);
    }
    if ((data.BankTransactions ?? []).length < 100) break;
  }
  console.log("");
}
