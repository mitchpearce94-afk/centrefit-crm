// READ-ONLY: per-supplier account-code history from approved/paid bills (last 12 months) → scripts/xero-supplier-coding.json
// Used to propose codes for draft bills. ~5 API calls.
import { readFileSync, writeFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
const env = Object.fromEntries(readFileSync(new URL("../.env.gc-probe", import.meta.url), "utf8").split("\n").filter((l) => l.includes("=")).map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, "").replace(/\\r|\\n/g, "").replace(/\r|\n/g, "").trim()]; }));
const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const { data: conn } = await supabase.from("xero_connections").select("id, tenant_id, access_token, refresh_token, expires_at").order("updated_at", { ascending: false }).limit(1).single();
let accessToken = conn.access_token;
if (!conn.expires_at || new Date(conn.expires_at).getTime() < Date.now() + 60_000) {
  const res = await fetch("https://identity.xero.com/connect/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", Authorization: "Basic " + Buffer.from(`${env.XERO_CLIENT_ID}:${env.XERO_CLIENT_SECRET}`).toString("base64") }, body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: conn.refresh_token }) });
  const tok = await res.json(); if (!res.ok) { console.error("refresh failed", JSON.stringify(tok)); process.exit(1); }
  accessToken = tok.access_token;
  await supabase.from("xero_connections").update({ access_token: tok.access_token, refresh_token: tok.refresh_token ?? conn.refresh_token, expires_at: new Date(Date.now() + (tok.expires_in ?? 1800) * 1000).toISOString(), updated_at: new Date().toISOString() }).eq("id", conn.id);
}
let calls = 0, dayLeft;
const xeroGet = async (path) => { const res = await fetch(`https://api.xero.com/api.xro/2.0/${path}`, { headers: { Authorization: `Bearer ${accessToken}`, "Xero-tenant-id": conn.tenant_id, Accept: "application/json" } }); calls++; dayLeft = res.headers.get("x-daylimit-remaining") ?? dayLeft; const t = await res.text(); try { return res.ok ? JSON.parse(t) : (console.error(res.status, t.slice(0, 120)), null); } catch { return null; } };
const since = new Date(Date.now() - 365 * 86400e3).toISOString().slice(0, 10).replace(/-/g, ",");
const bills = [];
for (let p = 1; p <= 8; p++) { const d = await xeroGet(`Invoices?where=${encodeURIComponent(`Type=="ACCPAY" AND (Status=="AUTHORISED" OR Status=="PAID") AND Date>=DateTime(${since})`)}&order=Date&page=${p}`); const a = d?.Invoices ?? []; bills.push(...a); if (a.length < 100) break; }
const accounts = Object.fromEntries((((await xeroGet("Accounts"))?.Accounts) ?? []).map((a) => [a.Code, { name: a.Name, type: a.Type, tax: a.TaxType }]));
const hist = {};
for (const b of bills) { const c = b.Contact?.Name || "?"; const h = (hist[c] ||= { bills: 0, codes: {}, tax: {}, last: null }); h.bills++; h.last = b.DateString?.slice(0, 10) || h.last; for (const l of b.LineItems || []) { if (l.AccountCode) h.codes[l.AccountCode] = (h.codes[l.AccountCode] || 0) + 1; if (l.TaxType) h.tax[l.TaxType] = (h.tax[l.TaxType] || 0) + 1; } }
const out = { at: new Date().toISOString(), calls, dayLeft, billsScanned: bills.length, accounts, suppliers: Object.fromEntries(Object.entries(hist).map(([c, h]) => { const top = Object.entries(h.codes).sort((a, b) => b[1] - a[1]); const tax = Object.entries(h.tax).sort((a, b) => b[1] - a[1]); return [c, { bills: h.bills, last: h.last, code: top[0]?.[0] || null, codeName: accounts[top[0]?.[0]]?.name || null, share: top.length ? +(top[0][1] / top.reduce((s, x) => s + x[1], 0)).toFixed(2) : 0, alts: top.slice(1, 3).map((x) => x[0]), tax: tax[0]?.[0] || null }]; })) };
writeFileSync(new URL("./xero-supplier-coding.json", import.meta.url), JSON.stringify(out, null, 2));
console.log(`bills ${bills.length}, suppliers ${Object.keys(out.suppliers).length}, calls ${calls}, day left ${dayLeft}`);
const drafts = JSON.parse(readFileSync(new URL("./xero-rec-today.json", import.meta.url), "utf8")).drafts;
console.log("\nPROPOSED CODING FOR TODAY'S DRAFTS (from history):");
for (const d of drafts) { const h = out.suppliers[d.contact]; console.log(`  ${d.date} ${(d.contact || "?").padEnd(38).slice(0, 38)} ${String(d.number || "").padEnd(14)} ${("$" + d.total.toFixed(2)).padStart(11)}  xero-default ${d.lines.map((l) => l.acct || "?").join(",").padEnd(5)} → ${h ? `${h.code} ${h.codeName} (${Math.round(h.share * 100)}% of ${h.bills} bills, ${h.tax})` : "NO HISTORY → review"}`); }
