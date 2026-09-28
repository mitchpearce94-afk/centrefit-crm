// Staff-facing "find the receipt" list from a hand-supplied set of unreconciled bank lines (pasted from Xero's Reconcile tab).
// Usage: node scripts/receipts-staff-list-from-lines.mjs <lines.json> "<Account title>" → ~/Downloads/Receipts-needed-<title>-<date>.pdf/.xlsx
import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
const xlsx = createRequire(`${process.env.HOME}/.cortex/scratch/xlsx/`)("xlsx");
const [src, title = "604 CF Technicians"] = process.argv.slice(2);
const rows = JSON.parse(readFileSync(src, "utf8")).map(([date, where, amount]) => ({ date, where, amount })).sort((a, b) => a.date.localeCompare(b.date));
const au = (iso) => new Date(iso + "T12:00:00+10:00").toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" });
const $ = (n) => n.toLocaleString("en-AU", { style: "currency", currency: "AUD" });
const esc = (s) => String(s ?? "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
const stamp = new Date().toISOString().slice(0, 10); const slug = title.replace(/[^A-Za-z0-9]+/g, "-");
const total = rows.reduce((s, r) => s + r.amount, 0);
const html = `<!doctype html><meta charset="utf-8"><style>body{font:13px/1.45 -apple-system,Segoe UI,Roboto,sans-serif;color:#111;margin:30px}h1{font-size:21px;margin:0 0 4px}.sub{color:#555;margin:0 0 14px}.how{background:#f3f4f6;border-left:4px solid #d97757;padding:10px 12px;margin:0 0 18px}table{width:100%;border-collapse:collapse}th{background:#111;color:#fff;text-align:left;padding:7px 8px;font-size:11.5px}td{padding:8px;border-bottom:1px solid #e5e7eb;vertical-align:top}tr:nth-child(even) td{background:#fafafa}td.amt{text-align:right;white-space:nowrap}td.box{width:60px;text-align:center;font-size:17px;color:#999}td.who{width:190px}</style><body>
<h1>Receipts needed — ${esc(title)}</h1><p class="sub">${rows.length} card purchases with no receipt yet · ${$(total)} · list prepared ${au(stamp)}</p>
<div class="how"><b>What to do:</b> if one of these was yours, find the receipt and <b>snap it in the CRM (Receipts → Snap)</b> or email a photo to <b>accounts@centrefit.com.au</b> with the date and amount in the subject. Tick the box once it's sent. If it wasn't yours, write who it was in the last column.</div>
<table><thead><tr><th>Date</th><th>Where</th><th style="text-align:right">Amount</th><th>Receipt sent</th><th>Who / what it was for</th></tr></thead><tbody>${rows.map((r) => `<tr><td>${au(r.date)}</td><td>${esc(r.where)}</td><td class="amt">${$(r.amount)}</td><td class="box">☐</td><td class="who"></td></tr>`).join("")}</tbody></table></body>`;
const h = `/tmp/receipts-${slug}.html`; writeFileSync(h, html);
const pdf = `${process.env.HOME}/Downloads/Receipts-needed-${slug}-${stamp}.pdf`;
execFileSync("/Users/mitchellpearce/Library/Caches/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-mac-arm64/chrome-headless-shell", ["--headless", "--disable-gpu", "--no-pdf-header-footer", `--print-to-pdf=${pdf}`, `file://${h}`], { stdio: "ignore" });
const wb = xlsx.utils.book_new(); const ws = xlsx.utils.json_to_sheet(rows.map((r) => ({ Date: au(r.date), Where: r.where, Amount: r.amount, "Receipt sent": "", "Who / what it was for": "" }))); ws["!cols"] = [{ wch: 13 }, { wch: 36 }, { wch: 11 }, { wch: 12 }, { wch: 30 }]; xlsx.utils.book_append_sheet(wb, ws, title.slice(0, 31));
const xl = `${process.env.HOME}/Downloads/Receipts-needed-${slug}-${stamp}.xlsx`; xlsx.writeFile(wb, xl);
console.log(`${rows.length} lines, ${$(total)}\n${pdf}\n${xl}`);
