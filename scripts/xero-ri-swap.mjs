// DD repeating-invoice swap batch (Mitchell-authorised 2026-06-11).
// Xero's API can't edit templates, so each defective template is recreated
// clean and the old one deleted. Rules:
//   - YEARLY / QUARTERLY / odd cadences: KEEP the current next-invoice date
//     exactly (Mitchell: "I don't want them getting billed when they
//     shouldn't be"). Only branding/flags change.
//   - MONTHLY: align to the GC charge day, choosing the first occurrence
//     that is >= the currently scheduled date — never earlier.
//   - Preserve: contact, lines, reference, amounts, currency, due-date
//     settings, ApprovedForSending/SendCopy (email behaviour unchanged).
//   - Set: IncludePDF=true, MarkAsSent=true, branding → Communications DD
//     (NBN lines) / Solutions DD (rest) when not already a DD theme.
//   - create → verify → delete old. Dry run with --dry.
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const DRY = process.argv.includes("--dry");
const LIMIT = process.argv.includes("--one") ? 1 : Infinity;

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
const XH = { Authorization: `Bearer ${tok}`, "Xero-tenant-id": conn.tenant_id, Accept: "application/json", "Content-Type": "application/json" };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function xeroPost(path, body) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch(`https://api.xero.com/api.xro/2.0/${path}`, { method: "POST", headers: XH, body: JSON.stringify(body) });
    if (res.status === 429) { await sleep((Number(res.headers.get("retry-after") ?? 5) + 1) * 1000); continue; }
    const text = await res.text();
    let j = null;
    try { j = text ? JSON.parse(text) : null; } catch { /* */ }
    if (!res.ok) {
      const ve = j?.Elements?.[0]?.ValidationErrors?.map((v) => v.Message).join("; ");
      throw new Error(ve ?? `HTTP ${res.status}: ${(text ?? "").slice(0, 200)}`);
    }
    return j;
  }
  throw new Error("rate-limited after retries");
}

const [risRes, themesRes] = await Promise.all([
  fetch("https://api.xero.com/api.xro/2.0/RepeatingInvoices", { headers: XH }),
  fetch("https://api.xero.com/api.xro/2.0/BrandingThemes", { headers: XH }),
]);
const allRis = ((await risRes.json()).RepeatingInvoices ?? []).filter((r) => r.Status === "AUTHORISED" && r.Type === "ACCREC");
const themes = ((await themesRes.json()).BrandingThemes ?? []);
const themeName = new Map(themes.map((t) => [t.BrandingThemeID, t.Name]));
const COMMS_DD = themes.find((t) => /communications dd/i.test(t.Name))?.BrandingThemeID;
const SOLUTIONS_DD = themes.find((t) => /solutions dd/i.test(t.Name))?.BrandingThemeID;
if (!COMMS_DD || !SOLUTIONS_DD) { console.error("DD themes missing"); process.exit(1); }

const { data: plans } = await supabase
  .from("recurring_plans")
  .select("id, customers(name), customer_sites(name), recurring_plan_gc_subscriptions(interval_unit, interval, day_of_month, start_date, gc_status)")
  .eq("status", "active");

const BRANDS = /\b(snap fitness|snap|sf|9 ?rounds?|core ?plus|coreplus|just focus|fit4eva|planet fitness|total fusion|fitness)\b/g;
const NOISE = /\b(pty|ltd|atf|t\/?a|trust|group|the|family|nominees|security|myalarm|duress intercom|duress|b2b|monitoring|intercom|homes|24\/?7|247)\b/g;
const norm = (s) => (s ?? "").toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
const tk = (s) => norm(s).replace(BRANDS, " ").replace(NOISE, " ").replace(/\s+/g, " ").trim().split(" ").filter((w) => w.length >= 3 && !/^\d+$/.test(w));
const match = (a, b) => { const bn = " " + norm(b) + " "; const t = tk(a); return t.length > 0 && t.every((x) => bn.includes(x)); };
const xd = (ms) => { const m = /\/Date\((\d+)/.exec(ms ?? ""); return m ? new Date(Number(m[1])) : null; };
const dstr = (d) => d.toISOString().slice(0, 10);

// Per RI: prefer the plan whose SITE matches the contact (customer-name
// matches span all of an owner's sites and would align dates to the wrong gym)
function planForRi(ri) {
  const n = ri.Contact?.Name ?? "";
  let bySite = null, byCust = null;
  for (const p of plans) {
    const site = (Array.isArray(p.customer_sites) ? p.customer_sites[0] : p.customer_sites)?.name ?? "";
    const cust = (Array.isArray(p.customers) ? p.customers[0] : p.customers)?.name ?? "";
    if (site && (match(site, n) || match(n, site))) { bySite = bySite ?? { p, label: site }; }
    else if (cust && (match(cust, n) || match(n, cust))) { byCust = byCust ?? { p, label: cust }; }
  }
  return bySite ?? byCust;
}

function cadenceOf(ri) {
  const u = ri.Schedule?.Unit, p = ri.Schedule?.Period ?? 1;
  if (u === "MONTHLY" && p === 1) return "monthly";
  return "other"; // yearly, quarterly, 13-weekly etc. — dates preserved
}

const today = new Date();
const work = [];
const seen = new Set();
for (const ri of allRis) {
  if (seen.has(ri.RepeatingInvoiceID)) continue;
  const hit = planForRi(ri);
  if (!hit) continue;
  seen.add(ri.RepeatingInvoiceID);
  const next = xd(ri.Schedule?.NextScheduledDate);
  if (!next) continue;

  const isDdTheme = /dd\s*$/i.test((themeName.get(ri.BrandingThemeID) ?? "").trim());
  const lines = (ri.LineItems ?? []).map((l) => l.Description ?? "").join(" ");
  const targetTheme = isDdTheme ? ri.BrandingThemeID : (/nbn/i.test(lines) ? COMMS_DD : SOLUTIONS_DD);

  // date: monthly only, never earlier than currently scheduled
  let newDate = next;
  let dateChanged = false;
  if (cadenceOf(ri) === "monthly") {
    const subs = (hit.p.recurring_plan_gc_subscriptions ?? []).filter((s) => s.gc_status !== "cancelled" && s.interval_unit === "monthly" && (s.interval ?? 1) === 1);
    const days = subs.map((s) => s.day_of_month ?? (s.start_date ? Number(s.start_date.slice(8, 10)) : null)).filter(Boolean);
    if (days.length > 0 && !days.includes(next.getUTCDate())) {
      const day = Math.min(days[0], 28);
      const cand = new Date(Date.UTC(next.getUTCFullYear(), next.getUTCMonth(), day));
      while (cand < next || cand <= today) cand.setUTCMonth(cand.getUTCMonth() + 1);
      newDate = cand;
      dateChanged = true;
    }
  }

  const ENABLE_SENDING = process.argv.includes("--enable-sending");
  if (ENABLE_SENDING) {
    // Mitchell 2026-06-11: every DD customer must actually RECEIVE their
    // invoice. Flip non-emailing templates to approved-for-sending.
    if (ri.ApprovedForSending === true) continue;
    work.push({ ri, site: hit.label, targetTheme, newDate: next, dateChanged: false, needsFlags: true, needsTheme: !isDdTheme, enableSending: true });
    continue;
  }
  // flags only matter on emailing templates — Xero ignores them otherwise
  const needsFlags = ri.ApprovedForSending === true && (ri.IncludePDF !== true || ri.MarkAsSent !== true);
  const needsTheme = !isDdTheme;
  if (!needsFlags && !needsTheme && !dateChanged) continue;
  work.push({ ri, site: hit.label, targetTheme, newDate, dateChanged, needsFlags, needsTheme });
}

// Emailing requires the Xero contact to have an email address — check and
// skip (report) any that don't.
if (process.argv.includes("--enable-sending") && work.length > 0) {
  const ids = [...new Set(work.map((w) => w.ri.Contact?.ContactID).filter(Boolean))];
  const emails = new Map();
  for (let i = 0; i < ids.length; i += 40) {
    const res = await fetch(`https://api.xero.com/api.xro/2.0/Contacts?IDs=${ids.slice(i, i + 40).join(",")}`, { headers: XH });
    const j = await res.json();
    for (const c of j.Contacts ?? []) emails.set(c.ContactID, c.EmailAddress ?? "");
    await sleep(1100);
  }
  const missing = work.filter((w) => !(emails.get(w.ri.Contact?.ContactID) ?? "").includes("@"));
  if (missing.length) {
    console.log("⚠ Contacts with NO email address — skipped, need addresses from Mitchell:");
    for (const m of [...new Set(missing.map((x) => x.ri.Contact?.Name))]) console.log(`   - ${m}`);
    console.log("");
  }
  const skipIds = new Set(missing.map((m) => m.ri.RepeatingInvoiceID));
  for (let i = work.length - 1; i >= 0; i--) if (skipIds.has(work[i].ri.RepeatingInvoiceID)) work.splice(i, 1);
}

console.log(`${DRY ? "[DRY RUN] " : ""}${work.length} templates to swap\n`);
let ok = 0, fail = 0;
for (const w of work.slice(0, LIMIT)) {
  const { ri } = w;
  const desc = `${w.site.slice(0, 26).padEnd(26)} $${String(ri.Total).padStart(8)} ${(ri.Schedule.Period + "x" + ri.Schedule.Unit).padEnd(10)}`;
  const changes = [
    w.needsTheme ? `theme→${themeName.get(w.targetTheme)}` : null,
    w.needsFlags ? "flags" : null,
    w.dateChanged ? `date ${dstr(xd(ri.Schedule.NextScheduledDate))}→${dstr(w.newDate)}` : `date kept ${dstr(xd(ri.Schedule.NextScheduledDate))}`,
  ].filter(Boolean).join(", ");
  if (DRY) { console.log(`would swap ${desc} — ${changes}`); continue; }
  try {
    const createBody = {
      Type: "ACCREC",
      Contact: { ContactID: ri.Contact.ContactID },
      Schedule: {
        Period: ri.Schedule.Period,
        Unit: ri.Schedule.Unit,
        // Legacy templates carry DueDate=0 ("due immediately") which the
        // create API rejects — clamp to 1 day after bill date.
        DueDate: ri.Schedule.DueDateType === "DAYSAFTERBILLDATE" ? Math.max(1, ri.Schedule.DueDate ?? 1) : ri.Schedule.DueDate,
        DueDateType: ri.Schedule.DueDateType,
        StartDate: dstr(w.newDate),
      },
      LineItems: (ri.LineItems ?? []).map((l) => ({
        Description: l.Description,
        Quantity: l.Quantity,
        UnitAmount: l.UnitAmount,
        ...(l.ItemCode ? { ItemCode: l.ItemCode } : {}),
        AccountCode: l.AccountCode,
        TaxType: l.TaxType,
        ...(l.DiscountRate ? { DiscountRate: l.DiscountRate } : {}),
      })),
      LineAmountTypes: ri.LineAmountTypes,
      ...(ri.Reference ? { Reference: ri.Reference } : {}),
      BrandingThemeID: w.targetTheme,
      CurrencyCode: ri.CurrencyCode,
      Status: "AUTHORISED",
      ApprovedForSending: w.enableSending ? true : (ri.ApprovedForSending ?? false),
      SendCopy: ri.SendCopy ?? false,
      MarkAsSent: true,
      IncludePDF: true,
    };
    const created = await xeroPost("RepeatingInvoices", { RepeatingInvoices: [createBody] });
    const newId = created?.RepeatingInvoices?.[0]?.RepeatingInvoiceID;
    if (!newId) throw new Error("create returned no id");
    await sleep(1100);
    await xeroPost(`RepeatingInvoices/${ri.RepeatingInvoiceID}`, { RepeatingInvoiceID: ri.RepeatingInvoiceID, Status: "DELETED" });
    await sleep(1100);
    ok++;
    console.log(`OK   ${desc} — ${changes} (new ${newId.slice(0, 8)}…)`);
  } catch (e) {
    fail++;
    console.log(`FAIL ${desc} — ${e.message}`);
  }
}
console.log(`\nDone: ${ok} swapped, ${fail} failed${DRY ? " (dry)" : ""}.`);
