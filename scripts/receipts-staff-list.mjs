// Staff-facing "find the receipt" list for card accounts (Mitchell 28 Sep 2026: "way more user friendly so I can send it to the staff").
// Pulls spend on the given Xero bank accounts since a date, drops the accounting columns, groups by month, and writes
// a PDF (one section per account) + a simple XLSX to ~/Downloads. Read-only.
// Usage: node scripts/receipts-staff-list.mjs [604,607] [2026-07-01]
import { readFileSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { createClient } from "@supabase/supabase-js";
const xlsx = createRequire(`${process.env.HOME}/.cortex/scratch/xlsx/`)("xlsx");
const [codesArg = "604,607", since = "2026-07-01"] = process.argv.slice(2);
const env = Object.fromEntries(readFileSync(new URL("../.env.gc-probe", import.meta.url), "utf8").split("\n").filter((l) => l.includes("=")).map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, "").replace(/\\r|\\n/g, "").replace(/\r|\n/g, "").trim()]; }));
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const { data: conn } = await sb.from("xero_connections").select("id, tenant_id, access_token, refresh_token, expires_at").order("updated_at", { ascending: false }).limit(1).single();
let at = conn.access_token;
if (!conn.expires_at || new Date(conn.expires_at).getTime() < Date.now() + 60_000) { const res = await fetch("https://identity.xero.com/connect/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", Authorization: "Basic " + Buffer.from(`${env.XERO_CLIENT_ID}:${env.XERO_CLIENT_SECRET}`).toString("base64") }, body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: conn.refresh_token }) }); const tok = await res.json(); if (!res.ok) { console.error("refresh failed"); process.exit(1); } at = tok.access_token; await sb.from("xero_connections").update({ access_token: tok.access_token, refresh_token: tok.refresh_token ?? conn.refresh_token, expires_at: new Date(Date.now() + (tok.expires_in ?? 1800) * 1000).toISOString(), updated_at: new Date().toISOString() }).eq("id", conn.id); }
const H = { Authorization: `Bearer ${at}`, "Xero-tenant-id": conn.tenant_id, Accept: "application/json" };
const x = async (p) => { const r = await fetch("https://api.xero.com/api.xro/2.0/" + p, { headers: H }); const t = await r.text(); if (!r.ok) throw new Error(`${p.split("?")[0]} ${r.status} ${t.slice(0, 160)}`); return JSON.parse(t); };
const pages = async (path, key) => { const out = []; for (let p = 1; p <= 8; p++) { const j = await x(`${path}&page=${p}`); const a = j[key] || []; out.push(...a); if (a.length < 100) break; } return out; };
const pd = (d) => { const m = /\/Date\((\d+)/.exec(d || ""); return m ? new Date(+m[1]).toISOString().slice(0, 10) : String(d || "").slice(0, 10); };
const W = encodeURIComponent, D = `DateTime(${since.replace(/-/g, ",")})`;
const au = (iso) => new Date(iso + "T12:00:00+10:00").toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" });
const month = (iso) => new Date(iso + "T12:00:00+10:00").toLocaleDateString("en-AU", { month: "long", year: "numeric" });
const $ = (n) => n.toLocaleString("en-AU", { style: "currency", currency: "AUD" });
const esc = (s) => String(s ?? "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
const accounts = (await x(`Accounts?where=${W('Type=="BANK"')}`)).Accounts;
const pays = await pages(`Payments?where=${W(`Date>=${D}`)}&order=Date`, "Payments");
const sections = [];
for (const code of codesArg.split(",")) {
  const acct = accounts.find((a) => a.Code === code); if (!acct) continue;
  const tx = (await pages(`BankTransactions?where=${W(`BankAccount.Code=="${code}" AND Date>=${D}`)}&order=Date`, "BankTransactions")).filter((t) => t.Status === "AUTHORISED" && t.Type === "SPEND" && !t.HasAttachments && !/^ANZ$|account servicing|bank fee|interest|merchant fee/i.test(t.Contact?.Name || "") && !/servicing fee|bank fee|interest/i.test((t.LineItems || []).map((l) => l.Description || "").join(" ")) && Number(t.Total) >= 1).map((t) => ({ date: pd(t.Date), where: t.Contact?.Name || "", what: (t.LineItems || []).map((l) => l.Description || "").filter(Boolean).join("; "), amount: Number(t.Total) }));
  const bp = pays.filter((p) => p.Account?.Code === code && p.PaymentType === "ACCPAYPAYMENT" && !p.Invoice?.HasAttachments).map((p) => ({ date: pd(p.Date), where: p.Invoice?.Contact?.Name || "", what: `Supplier invoice ${p.Invoice?.InvoiceNumber || ""}`.trim(), amount: Number(p.Amount) }));
  const rows = [...tx, ...bp].sort((a, b) => b.date.localeCompare(a.date));
  sections.push({ code, name: acct.Name.replace(/^CF /, "CF "), rows, total: rows.reduce((s, r) => s + r.amount, 0) });
}
const stamp = new Date().toISOString().slice(0, 10);
// ── PDF via headless Chromium ──
const CHROME = "/Users/mitchellpearce/Library/Caches/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-mac-arm64/chrome-headless-shell";
const html = `<!doctype html><meta charset="utf-8"><style>
body{font:12px/1.4 -apple-system,Segoe UI,Roboto,sans-serif;color:#111;margin:28px}
h1{font-size:20px;margin:0 0 4px} .sub{color:#555;margin:0 0 14px}
.how{background:#f3f4f6;border-left:4px solid #d97757;padding:10px 12px;margin:0 0 18px;font-size:12.5px}
h2{font-size:15px;margin:22px 0 6px;page-break-before:always} h2:first-of-type{page-break-before:auto}
table{width:100%;border-collapse:collapse;margin-bottom:8px} th{background:#111;color:#fff;text-align:left;padding:6px 8px;font-size:11px}
td{padding:6px 8px;border-bottom:1px solid #e5e7eb;vertical-align:top} tr:nth-child(even) td{background:#fafafa}
td.amt{text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums} td.box{width:54px;text-align:center;font-size:16px;color:#999}
tr.m td{background:#e8e8e8;font-weight:600;border-bottom:0;padding:5px 8px}
.tot{color:#555;font-size:11px;margin:0 0 6px}
</style><body>
<h1>Receipts needed — Centrefit card accounts</h1>
<p class="sub">Purchases with no receipt on file, 1 July to ${au(stamp)}. Prepared ${au(stamp)}.</p>
<div class="how"><b>What to do:</b> find your receipt for each purchase below and <b>snap it in the CRM (Receipts → Snap)</b> or email a photo to <b>accounts@centrefit.com.au</b> with the date and amount in the subject. Tick the box once it's sent. If the purchase wasn't yours, write who it was in the last column.</div>
${sections.map((s) => `<h2>${esc(s.code)} ${esc(s.name)}</h2><p class="tot">${s.rows.length} purchases · ${$(s.total)}</p><table><thead><tr><th>Date</th><th>Where</th><th>What it was for</th><th style="text-align:right">Amount</th><th>Receipt sent</th><th>Who / notes</th></tr></thead><tbody>${(() => { let last = ""; return s.rows.map((r) => { const m = month(r.date); const head = m !== last ? `<tr class="m"><td colspan="6">${m}</td></tr>` : ""; last = m; return head + `<tr><td>${au(r.date)}</td><td>${esc(r.where)}</td><td>${esc(r.what)}</td><td class="amt">${$(r.amount)}</td><td class="box">☐</td><td></td></tr>`; }).join(""); })()}</tbody></table>`).join("")}
</body>`;
const htmlPath = `/tmp/receipts-needed-${stamp}.html`; writeFileSync(htmlPath, html);
const pdf = `${process.env.HOME}/Downloads/Receipts-needed-${stamp}.pdf`;
execFileSync(CHROME, ["--headless", "--disable-gpu", "--no-pdf-header-footer", `--print-to-pdf=${pdf}`, `file://${htmlPath}`], { stdio: "ignore" });
// ── simple XLSX ──
const wb = xlsx.utils.book_new();
for (const s of sections) { const ws = xlsx.utils.json_to_sheet(s.rows.map((r) => ({ Date: au(r.date), Where: r.where, "What it was for": r.what, Amount: r.amount, "Receipt sent": "", "Who / notes": "" }))); ws["!cols"] = [{ wch: 13 }, { wch: 30 }, { wch: 44 }, { wch: 11 }, { wch: 12 }, { wch: 24 }]; xlsx.utils.book_append_sheet(wb, ws, `${s.code} ${s.name}`.slice(0, 31)); }
const xl = `${process.env.HOME}/Downloads/Receipts-needed-${stamp}.xlsx`; xlsx.writeFile(wb, xl);
console.log(sections.map((s) => `${s.code} ${s.name}: ${s.rows.length} purchases, ${$(s.total)}`).join("\n")); console.log(pdf); console.log(xl);
