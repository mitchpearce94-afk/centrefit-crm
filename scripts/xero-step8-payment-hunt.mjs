// READ-ONLY: for each Step-8 User-line item, hunt for the REAL money movement:
//  a) ANZ raw CSV (602 Group truth) — exact amount within +/-75 days, plus keyword hits
//  b) Xero BankTransactions across ALL bank accounts (same window, exact Total)
//  c) Xero Payments across ALL accounts (same window, exact Amount)
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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const xeroGet = async (path) => {
  for (let attempt = 1; attempt <= 3; attempt++) {
    const res = await fetch(`https://api.xero.com/api.xro/2.0/${path}`, {
      headers: { Authorization: `Bearer ${accessToken}`, "Xero-tenant-id": conn.tenant_id, Accept: "application/json" },
    });
    if (res.status === 429) { await sleep(3000 * attempt); continue; }
    const text = await res.text();
    let data = null; try { data = JSON.parse(text); } catch {}
    if (!res.ok) { console.error(`[WARN] ${path.split("?")[0]}:`, res.status, text.slice(0, 120)); return null; }
    return data;
  }
  return null;
};
const pd = (d) => { const m = /\/Date\((\d+)/.exec(d); return m ? new Date(Number(m[1])).toISOString().slice(0, 10) : String(d).slice(0, 10); };
const money = (n) => (n ?? 0).toLocaleString("en-AU", { style: "currency", currency: "AUD" });

// Bank account map (id -> name) so we can name where each hit lives
const accountsData = await xeroGet("Accounts?where=" + encodeURIComponent('Type=="BANK"'));
const bankName = {};
for (const a of accountsData?.Accounts ?? []) bankName[a.AccountID] = `${a.Code ?? "?"} ${a.Name}`;

// ANZ raw (602 truth)
const anz = readFileSync("C:/Users/mitch/Downloads/ANZ (1).csv", "utf8")
  .split(/\r?\n/).filter((l) => l.trim())
  .map((l) => {
    const m = /^(\d{2})\/(\d{2})\/(\d{4}),"(-?[\d.]+)",(.*)$/.exec(l);
    return m ? { iso: `${m[3]}-${m[2]}-${m[1]}`, amount: Number(m[4]), desc: m[5] } : null;
  }).filter(Boolean);

// Step-8 targets: [label, amount(+in/-out), User-line date, ANZ keyword regex]
const targets = [
  ["Electrocraft (Sep25)", -196.63, "2025-09-26", /ELECTROCRAFT/i],
  ["M2M One", -358.15, "2025-11-28", /M2M/i],
  ["Stubby Cafe", -61.00, "2026-03-16", /STUBBY/i],
  ["Brisbane Airport Parking", -185.00, "2026-03-20", /AIRPORT|PARKING/i],
  ["Youi (Mitch's van)", -281.94, "2026-03-30", /YOUI/i],
  ["Stronghold Locksmiths", -816.20, "2026-04-13", /STRONGHOLD/i],
  ["Back2Base Monitoring", -110.83, "2026-04-20", /BACK ?2 ?BASE|B2B/i],
  ["B2B Monitoring", -110.83, "2026-04-20", /BACK ?2 ?BASE|B2B/i],
  ["Telstra", -313.16, "2026-04-28", /TELSTRA/i],
  ["Security Distributors Aust", -1061.78, "2026-04-29", /SECURITY DIST|SDA/i],
  ["Guardal", -85.00, "2026-04-30", /GUARDAL/i],
  ["Upti", -74.14, "2026-04-30", /UPTI/i],
  ["No Contact", -988.25, "2026-05-05", /NO ?CONTACT/i],
  ["MWA Insurance", -384.32, "2026-05-08", /MWA/i],
  ["Electrocraft (Jun26/credit)", -1474.57, "2026-06-04", /ELECTROCRAFT/i],
  ["Workcover monthly", -475.16, "2026-06-08", /WORKCOV/i],
  ["IN DWSFT", 139.00, "2025-12-13", /DWS/i],
  ["IN Milton 24/7", 60.50, "2026-02-22", /MILTON/i],
  ["IN Snap Oxenford a", 60.50, "2026-04-20", /OXENFORD/i],
  ["IN Snap Oxenford b", 24.75, "2026-04-20", /OXENFORD/i],
  ["IN Leichhardt Fitness", 60.50, "2026-04-20", /LEICH/i],
];

const WINDOW = 75 * 86400_000;
const near = (isoA, isoB) => Math.abs(new Date(isoA) - new Date(isoB)) <= WINDOW;
const dtParam = (iso, shiftDays) => {
  const d = new Date(new Date(iso).getTime() + shiftDays * 86400_000);
  return `DateTime(${d.getUTCFullYear()},${d.getUTCMonth() + 1},${d.getUTCDate()})`;
};

for (const [label, amt, date, kw] of targets) {
  const absAmt = Math.abs(amt);
  console.log(`\n### ${label}  ${money(amt)}  (User line ${date})`);

  // a) ANZ 602 — amount within window, plus keyword hits any date
  const amtHits = anz.filter((l) => Math.abs(Math.abs(l.amount) - absAmt) < 0.005 && near(l.iso, date));
  const kwHits = anz.filter((l) => kw.test(l.desc) && near(l.iso, date) && !amtHits.includes(l));
  for (const h of amtHits) console.log(`  ANZ-602 AMOUNT: ${h.iso}  ${money(h.amount).padStart(12)}  ${h.desc.slice(0, 60)}`);
  for (const h of kwHits.slice(0, 6)) console.log(`  ANZ-602 KEYWORD: ${h.iso}  ${money(h.amount).padStart(12)}  ${h.desc.slice(0, 60)}`);
  if (!amtHits.length && !kwHits.length) console.log("  ANZ-602: no amount or keyword match in window");

  // b) Xero BankTransactions, all bank accounts, exact Total in window
  const whereB = encodeURIComponent(`Total==${absAmt.toFixed(2)} AND Status=="AUTHORISED" AND Date>=${dtParam(date, -75)} AND Date<=${dtParam(date, 75)}`);
  const bt = await xeroGet(`BankTransactions?where=${whereB}`);
  for (const t of bt?.BankTransactions ?? []) {
    const acct = bankName[t.BankAccount?.AccountID] ?? t.BankAccount?.Name ?? "?";
    console.log(`  XERO BankTxn: ${pd(t.Date)}  ${String(t.Type).padEnd(8)} ${money(t.Total).padStart(12)}  acct=${acct}  rec=${t.IsReconciled ? "Y" : "N"}  ${(t.Contact?.Name ?? "?").slice(0, 30)}`);
  }
  await sleep(700);

  // c) Xero Payments, exact Amount in window (any account)
  const whereP = encodeURIComponent(`Amount==${absAmt.toFixed(2)} AND Status=="AUTHORISED" AND Date>=${dtParam(date, -75)} AND Date<=${dtParam(date, 75)}`);
  const pays = await xeroGet(`Payments?where=${whereP}`);
  for (const p of pays?.Payments ?? []) {
    const acct = bankName[p.Account?.AccountID] ?? `${p.Account?.Code ?? "?"}`;
    console.log(`  XERO Payment: ${pd(p.Date)}  ${money(p.Amount).padStart(12)}  acct=${acct}  rec=${p.IsReconciled ? "Y" : "N"}  ${(p.Invoice?.Contact?.Name ?? "?").slice(0, 30)}  ${(p.Invoice?.InvoiceNumber ?? "")}`);
  }
  if (!(bt?.BankTransactions ?? []).length && !(pays?.Payments ?? []).length) console.log("  XERO: no matching transaction/payment in any account");
  await sleep(700);
}
console.log("\nDone. Note: uncoded feed lines in Techs/CC accounts are invisible to the API — a 'not found' here means check those Reconcile tabs by eye.");
