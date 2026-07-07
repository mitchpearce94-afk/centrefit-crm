// 2026-07-07 — READ-ONLY: historical GC-vs-Xero recon (2026-01-01 .. 2026-05-25).
// Every GC payment that took money (confirmed/paid_out) must have a Xero invoice
// (amount ±$0.02, charge_date ±12d, greedy 1:1). Unmatched = collected but never invoiced.
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const env = Object.fromEntries(
  readFileSync(new URL("../.env.gc-probe", import.meta.url), "utf8")
    .split("\n").filter((l) => l.includes("="))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, "").replace(/\\r|\\n/g, "").trim()]; }),
);
const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const { data: conn } = await supabase.from("xero_connections").select("id, tenant_id, access_token, refresh_token, expires_at").order("updated_at", { ascending: false }).limit(1).single();
let tok = conn.access_token;
if (!conn.expires_at || new Date(conn.expires_at).getTime() < Date.now() + 60000) {
  const res = await fetch("https://identity.xero.com/connect/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Authorization: "Basic " + Buffer.from(`${env.XERO_CLIENT_ID}:${env.XERO_CLIENT_SECRET}`).toString("base64") },
    body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: conn.refresh_token }),
  });
  const t = await res.json();
  tok = t.access_token;
  await supabase.from("xero_connections").update({ access_token: t.access_token, refresh_token: t.refresh_token ?? conn.refresh_token, expires_at: new Date(Date.now() + (t.expires_in ?? 1800) * 1000).toISOString(), updated_at: new Date().toISOString() }).eq("id", conn.id);
}
const XH = { Authorization: `Bearer ${tok}`, "Xero-tenant-id": conn.tenant_id, Accept: "application/json" };
const GCH = { Authorization: `Bearer ${env.GOCARDLESS_API_TOKEN}`, "GoCardless-Version": "2015-07-06", Accept: "application/json" };
const xd = (ms) => { const m = /\/Date\((\d+)/.exec(ms ?? ""); return m ? new Date(Number(m[1])).toISOString().slice(0, 10) : null; };
const dayDiff = (a, b) => Math.round((Date.parse(a) - Date.parse(b)) / 86400000);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function gcList(path, params) {
  const out = [];
  let after;
  for (;;) {
    const q = new URLSearchParams({ limit: "500", ...params, ...(after ? { after } : {}) });
    const j = await (await fetch(`https://api.gocardless.com/${path}?${q}`, { headers: GCH })).json();
    out.push(...(j[path] ?? []));
    after = j.meta?.cursors?.after;
    if (!after) break;
    await sleep(300);
  }
  return out;
}

const [payments, mandates, customers] = [
  await gcList("payments", { "charge_date[gte]": "2026-01-01", "charge_date[lte]": "2026-05-25", "status": "paid_out" }),
  await gcList("mandates", {}),
  await gcList("customers", {}),
];
const confirmed = await gcList("payments", { "charge_date[gte]": "2026-01-01", "charge_date[lte]": "2026-05-25", "status": "confirmed" });
payments.push(...confirmed);
const custById = new Map(customers.map((c) => [c.id, c]));
const mandById = new Map(mandates.map((m) => [m.id, m]));
const payName = (p) => {
  const m = mandById.get(p.links?.mandate);
  const c = m ? custById.get(m.links?.customer) : null;
  return c ? `${c.company_name ?? ""} ${c.given_name ?? ""} ${c.family_name ?? ""}`.trim() : "?";
};

const invs = [];
for (let page = 1; ; page++) {
  const url = `https://api.xero.com/api.xro/2.0/Invoices?Statuses=DRAFT,SUBMITTED,AUTHORISED,PAID&where=${encodeURIComponent('Type=="ACCREC" AND Date>=DateTime(2025,12,15) AND Date<DateTime(2026,6,10)')}&order=Date&page=${page}&pageSize=100`;
  const batch = (await (await fetch(url, { headers: XH })).json()).Invoices ?? [];
  invs.push(...batch);
  if (batch.length < 100) break;
  await sleep(600);
}
console.log(`${payments.length} GC money payments Jan1–May25, ${invs.length} Xero invoices Dec15–Jun10`);

// greedy 1:1 match, nearest date first
const pool = invs.map((i) => ({ inv: i, date: xd(i.Date), total: Number(i.Total), used: false }));
const unmatched = [];
for (const p of payments.sort((a, b) => a.charge_date.localeCompare(b.charge_date))) {
  const cands = pool
    .filter((c) => !c.used && Math.abs(c.total - p.amount / 100) < 0.02 && Math.abs(dayDiff(c.date, p.charge_date)) <= 12)
    .sort((a, b) => Math.abs(dayDiff(a.date, p.charge_date)) - Math.abs(dayDiff(b.date, p.charge_date)));
  if (cands.length) { cands[0].used = true; continue; }
  unmatched.push(p);
}
console.log(`\n=== ${unmatched.length} GC payments with NO matching invoice ===`);
let sum = 0;
for (const p of unmatched) {
  sum += p.amount / 100;
  console.log(`${p.charge_date}  $${(p.amount / 100).toFixed(2).padEnd(8)} ${p.status.padEnd(10)} ${payName(p)}`);
}
console.log(`\nTotal collected-but-uninvoiced (Jan–May): $${sum.toFixed(2)}`);
