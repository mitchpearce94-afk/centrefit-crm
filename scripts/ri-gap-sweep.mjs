// 2026-07-07 — READ-ONLY: find every RI whose latest expected occurrence has NO invoice
// (the "swap gap": old RI deleted before firing, new RI starts next cycle).
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
const xd = (ms) => { const m = /\/Date\((\d+)/.exec(ms ?? ""); return m ? new Date(Number(m[1])).toISOString().slice(0, 10) : null; };
const TODAY = "2026-07-07";

// Previous occurrence before `next` given the schedule
function prevOcc(next, unit, period) {
  const [y, m, d] = next.split("-").map(Number);
  if (unit === "MONTHLY") {
    const dt = new Date(Date.UTC(y, m - 1 - period, Math.min(d, 28)));
    // keep original day where valid (Xero anchors to day-of-month)
    const yy = dt.getUTCFullYear(), mm = dt.getUTCMonth();
    const last = new Date(Date.UTC(yy, mm + 1, 0)).getUTCDate();
    return new Date(Date.UTC(yy, mm, Math.min(d, last))).toISOString().slice(0, 10);
  }
  if (unit === "WEEKLY") {
    const dt = new Date(Date.UTC(y, m - 1, d));
    dt.setUTCDate(dt.getUTCDate() - 7 * period);
    return dt.toISOString().slice(0, 10);
  }
  return null;
}
const dayDiff = (a, b) => Math.round((Date.parse(a) - Date.parse(b)) / 86400000);

// 1. All AUTHORISED RIs
const ris = ((await (await fetch("https://api.xero.com/api.xro/2.0/RepeatingInvoices", { headers: XH })).json()).RepeatingInvoices ?? [])
  .filter((r) => r.Type === "ACCREC" && r.Status === "AUTHORISED");

// 2. All org invoices since 25 May, all live statuses (paged)
const invs = [];
for (let page = 1; ; page++) {
  const url = `https://api.xero.com/api.xro/2.0/Invoices?Statuses=DRAFT,SUBMITTED,AUTHORISED,PAID&where=${encodeURIComponent('Type=="ACCREC" AND Date>=DateTime(2026,5,25)')}&order=Date&page=${page}&pageSize=100`;
  const batch = (await (await fetch(url, { headers: XH })).json()).Invoices ?? [];
  invs.push(...batch);
  if (batch.length < 100) break;
  await new Promise((r) => setTimeout(r, 600));
}
console.log(`${ris.length} live RIs, ${invs.length} live invoices since 2026-05-25\n`);

// 3. For each live RI: walk back up to 3 occurrences from NextScheduledDate. Any occurrence
//    in [2026-06-01 .. today] with no live invoice for same contact ±10d at the RI amount -> GAP.
const covered = (cid, total, o) => invs.find((i) => i.Contact?.ContactID === cid
  && Math.abs(Number(i.Total) - Number(total)) < 0.01
  && Math.abs(dayDiff(xd(i.Date), o)) <= 10);

const gaps = [];
for (const r of ris) {
  const next = xd(r.Schedule?.NextScheduledDate);
  const unit = r.Schedule?.Unit, period = r.Schedule?.Period;
  if (!next || !unit || !period) continue;
  let cursor = next;
  for (let k = 0; k < 3; k++) {
    cursor = prevOcc(cursor, unit, period);
    if (!cursor || cursor < "2026-06-01") break;
    if (cursor > TODAY) continue;
    if (!covered(r.Contact?.ContactID, r.Total, cursor)) {
      gaps.push({ contact: r.Contact?.Name, ref: r.Reference ?? "", total: r.Total, missed: cursor, next, unit: `${period} ${unit}`, id: r.RepeatingInvoiceID });
    }
  }
}
gaps.sort((a, b) => (a.missed + a.contact).localeCompare(b.missed + b.contact));
console.log(`=== ${gaps.length} missed occurrences on LIVE RIs (no matching invoice) ===`);
for (const g of gaps) console.log(`${g.missed}  $${String(g.total).padEnd(8)} ${(g.contact ?? "?").padEnd(38)} "${g.ref}"  next=${g.next}  [${g.unit}]  ${g.id.slice(0, 8)}`);
const sum = gaps.reduce((s, g) => s + Number(g.total), 0);
console.log(`\nTotal missed billing (live RIs): $${sum.toFixed(2)}`);

// 4. DELETED RIs with a due occurrence and NO successor RI (same contact + amount) -> service dropped entirely
const risAll = ((await (await fetch("https://api.xero.com/api.xro/2.0/RepeatingInvoices", { headers: XH })).json()).RepeatingInvoices ?? [])
  .filter((r) => r.Type === "ACCREC");
const deleted = risAll.filter((r) => r.Status === "DELETED");
const orphans = [];
for (const r of deleted) {
  const next = xd(r.Schedule?.NextScheduledDate);
  if (!next || next < "2026-06-01" || next > TODAY) continue;
  const successor = ris.find((a) => a.Contact?.ContactID === r.Contact?.ContactID && Math.abs(a.Total - r.Total) < 0.01);
  if (successor) continue; // gap already assessed via the live successor above
  if (!covered(r.Contact?.ContactID, r.Total, next)) {
    orphans.push({ contact: r.Contact?.Name, ref: r.Reference ?? "", total: r.Total, due: next, id: r.RepeatingInvoiceID });
  }
}
orphans.sort((a, b) => (a.contact ?? "").localeCompare(b.contact ?? ""));
console.log(`\n=== ${orphans.length} DELETED RIs, occurrence due, NO successor & no invoice ===`);
for (const g of orphans) console.log(`${g.due}  $${String(g.total).padEnd(8)} ${(g.contact ?? "?").padEnd(38)} "${g.ref}"  ${g.id.slice(0, 8)}`);
