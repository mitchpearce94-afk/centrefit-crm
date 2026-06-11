// Build the "Unbilled Services" worklist PDF from the latest recon report.
import { readFileSync, createWriteStream } from "node:fs";
import PDFDocument from "pdfkit";

const md = readFileSync(new URL("./recon-report.md", import.meta.url), "utf8");
let section = md.slice(md.indexOf("## ❌ UNBILLED"));
const nh = section.indexOf("\n## ", 4);
if (nh !== -1) section = section.slice(0, nh);
const rows = section.split("\n").filter((l) => l.startsWith("|")).slice(2).map((l) => {
  const c = l.split("|").map((s) => s.trim());
  return { kind: c[1], name: c[2], detail: c[3], est: Number((c[4] ?? "").replace(/[^0-9.]/g, "")) || 0, near: c[5] === "none" ? "" : (c[5] ?? "") };
}).filter((r) => r.name);

const KINDS = [
  ["nbn", "NBN circuits", "Kinetix bills us per active circuit"],
  ["monitoring", "Alarm monitoring", "Sentinel back-to-base"],
  ["sim", "SIM cards", "M2M One data SIMs"],
  ["myalarm", "MyAlarm subscriptions", "Yearly iFob app"],
  ["duress", "Duress intercom", "Monitoring only"],
];
const PERSONAL = /sue pearce|mark pearce|allan bowman|milroy|michael murphy/i;
const total = rows.reduce((s, r) => s + r.est, 0);

const OUT = "C:/Users/mitch/Downloads/Unbilled Services 2026-06-11.pdf";
const doc = new PDFDocument({ size: "A4", margins: { top: 56, bottom: 56, left: 48, right: 48 } });
doc.pipe(createWriteStream(OUT));

const NAVY = "#0a0f1c", CYAN = "#0891b2", GREY = "#64748b", LIGHT = "#e2e8f0", RED = "#dc2626";
const W = doc.page.width - 96;

// ── cover header ─────────────────────────────────────────────────────────────
doc.rect(0, 0, doc.page.width, 150).fill(NAVY);
doc.fill("#ffffff").font("Helvetica-Bold").fontSize(22).text("Unbilled Services — Worklist", 48, 44);
doc.font("Helvetica").fontSize(10).fill("#94a3b8")
  .text(`Centrefit Group · generated 11/06/2026 · services we pay for with no DD plan or authorised Xero repeating invoice`, 48, 78, { width: W });
doc.fontSize(10).fill("#67e8f9")
  .text(`${rows.length} services  ·  estimated $${total.toFixed(2)}/month  (~$${Math.round(total * 12).toLocaleString()}/year)`, 48, 104);

doc.fill("#0f172a").fontSize(9).font("Helvetica");
doc.text("How to work it: tick each line as you resolve it. Fix is one of —  (A) Add service to their existing plan · (B) New plan + signup link · (C) Bill via Xero repeating invoice · (D) Personal/comp — leave, note it · (E) Cancel the service we're paying for.", 48, 166, { width: W });

let y = 200;

function ensureSpace(h) {
  if (y + h > doc.page.height - 64) { doc.addPage(); y = 56; }
}

for (const [kind, title, sub] of KINDS) {
  const group = rows.filter((r) => r.kind === kind).sort((a, b) => b.est - a.est);
  if (group.length === 0) continue;
  const gTotal = group.reduce((s, r) => s + r.est, 0);

  ensureSpace(54);
  doc.rect(48, y, W, 26).fill("#f1f5f9");
  doc.fill(NAVY).font("Helvetica-Bold").fontSize(12).text(title, 58, y + 7);
  doc.fill(GREY).font("Helvetica").fontSize(8.5).text(sub, 58 + doc.widthOfString(title) + 14, y + 10);
  doc.fill(CYAN).font("Helvetica-Bold").fontSize(10).text(`${group.length} · $${gTotal.toFixed(2)}/mo`, 48, y + 8, { width: W - 10, align: "right" });
  y += 36;

  for (const r of group) {
    const personal = PERSONAL.test(r.name);
    const hint = personal ? "Personal/comp? → D" : r.near ? `Partial billing exists → likely A` : "No billing found → B / C / E";
    const detail = [r.detail, r.near ? `match: ${r.near.replace(/(plan:|xero:)/g, "")}` : ""].filter(Boolean).join("  ·  ");
    const rowH = detail ? 34 : 24;
    ensureSpace(rowH + 4);

    doc.rect(52, y + 2, 10, 10).lineWidth(1).stroke("#94a3b8"); // checkbox
    doc.fill(personal ? GREY : "#0f172a").font("Helvetica-Bold").fontSize(10).text(r.name, 72, y, { width: 250 });
    doc.fill(r.est >= 100 ? RED : "#0f172a").font("Helvetica-Bold").fontSize(10).text(`$${r.est.toFixed(2)}`, 330, y, { width: 60, align: "right" });
    doc.fill(GREY).font("Helvetica").fontSize(8.5).text(hint, 402, y + 1, { width: W - 360 });
    if (detail) doc.fill("#94a3b8").font("Helvetica").fontSize(8).text(detail.slice(0, 160), 72, y + 13, { width: W - 40 });
    y += rowH;
    doc.moveTo(48, y - 4).lineTo(48 + W, y - 4).lineWidth(0.5).stroke(LIGHT);
  }
  y += 10;
}

ensureSpace(70);
doc.rect(48, y, W, 50).fill(NAVY);
doc.fill("#ffffff").font("Helvetica-Bold").fontSize(11).text(`Total recoverable: $${total.toFixed(2)}/month  ·  ~$${Math.round(total * 12).toLocaleString()}/year`, 60, y + 10);
doc.fill("#94a3b8").font("Helvetica").fontSize(8.5).text("Tools: customer page → Direct Debits tab · plan page → Add Service · new-plan wizard → signup link. Weekly NBN watchdog re-checks Kinetix every Monday 7:30am.", 60, y + 27, { width: W - 24 });

doc.end();
console.log(`Wrote ${OUT} — ${rows.length} rows, $${total.toFixed(2)}/mo`);


