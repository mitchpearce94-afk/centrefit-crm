// NBN tier-mismatch audit: every Kinetix circuit's speed vs what the customer
// is actually billed (CRM DD plan items or Xero RI lines), with names,
// addresses and the money delta. Outputs console + PDF worklist.
import { readFileSync, createWriteStream } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import PDFDocument from "pdfkit";

const env = Object.fromEntries(
  readFileSync(new URL("../.env.gc-probe", import.meta.url), "utf8")
    .split("\n").filter((l) => l.includes("="))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, "").replace(/\\r|\\n/g, "").trim()]; }),
);
const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const dd = JSON.parse(readFileSync(new URL("./dd-sheet-output.json", import.meta.url), "utf8"));
const xeroRis = JSON.parse(readFileSync(new URL("./xero-repeating-output.json", import.meta.url), "utf8"))
  .filter((r) => r.Status === "AUTHORISED")
  .map((r) => ({
    contact: r.Contact?.Name ?? "",
    total: r.Total ?? 0,
    lines: (r.LineItems ?? []).map((l) => ({ d: l.Description ?? "", amt: l.LineAmount ?? 0 })),
  }));

const { data: plans } = await supabase
  .from("recurring_plans")
  .select("id, customers(name), customer_sites(name), recurring_plan_items(service_code, service_name, price_inc_gst, frequency)")
  .eq("status", "active");
const planRecords = (plans ?? []).map((p) => ({
  customer: (Array.isArray(p.customers) ? p.customers[0] : p.customers)?.name ?? "",
  site: (Array.isArray(p.customer_sites) ? p.customer_sites[0] : p.customer_sites)?.name ?? "",
  items: p.recurring_plan_items ?? [],
}));

const BRANDS = /\b(snap fitness|snap|sf|9 ?rounds?|core ?plus|coreplus|just focus|fit4eva|planet fitness|total fusion|fitness)\b/g;
const NOISE = /\b(pty|ltd|atf|t\/?a|trust|group|the|family|nominees|security|myalarm|duress intercom|duress|b2b|monitoring|intercom|homes|24\/?7|247|qld|nsw|vic|wa|sa|tas|nt|act)\b/g;
const norm = (s) => (s ?? "").toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
const toks = (s) => norm(s).replace(BRANDS, " ").replace(NOISE, " ").replace(/\s+/g, " ").trim().split(" ").filter((w) => w.length >= 3 && !/^\d+$/.test(w));
const nameMatches = (a, b) => { const bn = " " + norm(b) + " "; const t = toks(a); return t.length > 0 && t.every((x) => bn.includes(x)); };

const LIST = { "100/20": 129, "100/40": 139, "250/100": 149, "500/200": 169, "1000/400": 239, "2000/500": 339 };
const speedOf = (s) => { const m = /(\d{2,4})\s*\/\s*(\d{2,4})/.exec(s ?? ""); return m ? `${m[1]}/${m[2]}` : null; };
const tierFromAmount = (amt) => ({ 129: "100/20", 139: "100/40", 149: "250/100", 169: "500/200", 239: "1000/400", 339: "2000/500", 110: "100/20", 110.0: "100/20" })[amt] ?? null;

// pre-decided resolutions
const DECISIONS = [
  { re: /north ?shore/i, note: "DECIDED: drop circuit to 100/40 (keep $139 invoice) — Mitchell 11/06" },
  { re: /currimundi|salt health/i, note: "DONE 11/06: DD sub upgraded to 250/100 $149; Xero line swaps Fri AM" },
  { re: /tfbl|springfield/i, note: "PLANNED: reprice to 500/200 $169 (cheaper than current $269 bundle) — stays invoice-only (Total Fusion rule)" },
];

function findNbnBilling(name) {
  // DD plan items first
  for (const p of planRecords) {
    if (!(nameMatches(name, p.site) || nameMatches(p.site, name) || nameMatches(name, p.customer))) continue;
    const item = p.items.find((i) => /nbn|\d{2,4}\s*\/\s*\d{2,4}/i.test(`${i.service_code} ${i.service_name}`));
    if (item) return { via: "DD", who: p.site || p.customer, lineText: item.service_name, amt: Number(item.price_inc_gst) };
  }
  // Xero RI lines
  for (const r of xeroRis) {
    if (!(nameMatches(name, r.contact) || nameMatches(r.contact, name))) continue;
    const line = r.lines.find((l) => /nbn|bundle\s*\d|internet|\d{2,4}\s*\/\s*\d{2,4}/i.test(l.d));
    if (line) return { via: "Xero", who: r.contact, lineText: line.d, amt: line.amt || r.total };
  }
  return null;
}

const INTERNAL = /centrefit|cf 4g|sue pearce|mark pearce/i;
const rows = [];
for (const r of dd["Kinetix "].slice(1)) {
  if (!r[7] || !/active/i.test(String(r[3] ?? ""))) continue;
  const name = String(r[7]).trim();
  if (INTERNAL.test(name)) continue;
  const circuit = speedOf(String(r[6] ?? ""));
  if (!circuit) continue;
  const address = [r[10], r[11], r[12]].map((x) => String(x ?? "").trim()).filter(Boolean).join(", ");
  const billing = findNbnBilling(name);
  if (!billing) continue; // unbilled — that's the other report
  const billedSpeed = speedOf(billing.lineText) ?? tierFromAmount(billing.amt);
  const listPrice = LIST[circuit] ?? null;
  const speedMismatch = billedSpeed && billedSpeed !== circuit;
  const priceOffList = listPrice != null && Math.abs(billing.amt - listPrice) > 1 && /nbn|\d+\/\d+/i.test(billing.lineText);
  if (!speedMismatch && !priceOffList) continue;
  const decision = DECISIONS.find((d) => d.re.test(name + " " + billing.who))?.note ?? null;
  rows.push({ name, address, circuit, billedSpeed: billedSpeed ?? "?", amt: billing.amt, listPrice, via: billing.via, who: billing.who, lineText: billing.lineText, decision, speedMismatch });
}

rows.sort((a, b) => (b.speedMismatch ? 1 : 0) - (a.speedMismatch ? 1 : 0) || (b.listPrice ?? 0) - (b.amt ?? 0) - ((a.listPrice ?? 0) - (a.amt ?? 0)));

console.log(`${rows.length} circuits where billed tier/price ≠ circuit\n`);
for (const r of rows) {
  console.log(`${r.name.padEnd(32)} circuit ${r.circuit.padEnd(9)} billed ${String(r.billedSpeed).padEnd(9)} $${String(r.amt).padEnd(8)} list@circuit $${r.listPrice ?? "?"} [${r.via}: ${r.who.slice(0, 30)}]${r.decision ? " — " + r.decision : ""}`);
}

// ── PDF ──────────────────────────────────────────────────────────────────────
const OUT = "C:/Users/mitch/Downloads/NBN Plan Mismatch Audit 2026-06-11.pdf";
const doc = new PDFDocument({ size: "A4", layout: "landscape", margins: { top: 48, bottom: 48, left: 40, right: 40 } });
doc.pipe(createWriteStream(OUT));
const NAVY = "#0a0f1c", GREY = "#64748b", LIGHT = "#e2e8f0", RED = "#dc2626", GREEN = "#059669";
const W = doc.page.width - 80;

doc.rect(0, 0, doc.page.width, 110).fill(NAVY);
doc.fill("#ffffff").font("Helvetica-Bold").fontSize(20).text("NBN Plan Mismatch Audit", 40, 34);
doc.font("Helvetica").fontSize(9.5).fill("#94a3b8")
  .text(`Centrefit Communications · 11/06/2026 · circuits whose Kinetix speed tier or price doesn't match what the customer is billed. Fix is always one of: raise/correct the invoice · drop the circuit tier · accept and note.`, 40, 64, { width: W });

let y = 130;
const cols = [
  ["Site / Customer", 40, 150],
  ["Address", 195, 135],
  ["Circuit", 335, 52],
  ["Billed as", 392, 52],
  ["Paying", 449, 48],
  ["List @ circuit", 502, 60],
  ["Billed via", 567, 150],
  ["Action / decision", 722, doc.page.width - 762],
];
function header() {
  doc.rect(40, y, W, 20).fill("#f1f5f9");
  doc.fill(NAVY).font("Helvetica-Bold").fontSize(8);
  for (const [t, x, w] of cols) doc.text(t, x + 4, y + 6, { width: w - 6 });
  y += 24;
}
header();
for (const r of rows) {
  const h = 30;
  if (y + h > doc.page.height - 56) { doc.addPage({ layout: "landscape" }); y = 48; header(); }
  const delta = r.listPrice != null ? r.listPrice - r.amt : null;
  const action = r.decision ?? (r.speedMismatch
    ? (delta != null && delta > 0 ? `Circuit faster than billed — raise to $${r.listPrice} or drop circuit to ${r.billedSpeed}` : `Circuit ≠ billed — review`)
    : `Price off current list ($${r.listPrice}) — reprice or note legacy deal`);
  doc.fill("#0f172a").font("Helvetica-Bold").fontSize(8.5).text(r.name.slice(0, 40), 44, y, { width: 146 });
  doc.fill(GREY).font("Helvetica").fontSize(7.5).text(r.address.slice(0, 50) || "—", 199, y, { width: 131 });
  doc.fill("#0f172a").font("Helvetica-Bold").fontSize(9).text(r.circuit, 339, y);
  doc.fill(r.speedMismatch ? RED : "#0f172a").font("Helvetica-Bold").fontSize(9).text(String(r.billedSpeed), 396, y);
  doc.fill("#0f172a").font("Helvetica").fontSize(8.5).text(`$${r.amt}`, 453, y);
  doc.fill(delta != null && delta > 0 ? GREEN : GREY).font("Helvetica").fontSize(8.5).text(r.listPrice != null ? `$${r.listPrice}` : "—", 506, y);
  doc.fill(GREY).font("Helvetica").fontSize(7.5).text(`${r.via}: ${r.who.slice(0, 36)} — ${r.lineText.slice(0, 30)}`, 571, y, { width: 146 });
  doc.fill(r.decision ? GREEN : "#0f172a").font("Helvetica").fontSize(7.5).text(action.slice(0, 130), 726, y, { width: doc.page.width - 766 });
  y += h;
  doc.moveTo(40, y - 6).lineTo(40 + W, y - 6).lineWidth(0.5).stroke(LIGHT);
}

doc.fill(GREY).font("Helvetica").fontSize(8).text(`${rows.length} mismatches. Green action = already decided. Circuit downgrades save wholesale cost with zero customer impact; invoice raises need a customer conversation (lead with upgrades-for-free or new-pricing-savings where applicable).`, 40, y + 8, { width: W });
doc.end();
console.log(`\nWrote ${OUT}`);
