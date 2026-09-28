// READ-ONLY: spreadsheet of card/bank transactions on the given Xero bank accounts (default 604 CF Technicians + 607 CF Solutions)
// since a date, with reconciled / receipt-attached flags and the receipt (Xero draft bill or Snap upload) that matches each one.
// Usage: NODE_PATH=~/.cortex/scratch/xlsx/node_modules node scripts/receipts-to-reconcile.mjs [604,607] [2026-07-01] → ~/Downloads/receipts-to-reconcile-<date>.xlsx
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { createClient } from "@supabase/supabase-js";
const xlsx = createRequire(`${process.env.HOME}/.cortex/scratch/xlsx/`)("xlsx");
const [codesArg = "604,607", since = "2026-07-01"] = process.argv.slice(2);
const CODES = codesArg.split(",");
const env = Object.fromEntries(readFileSync(new URL("../.env.gc-probe", import.meta.url), "utf8").split("\n").filter((l) => l.includes("=")).map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, "").replace(/\\r|\\n/g, "").replace(/\r|\n/g, "").trim()]; }));
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const { data: conn } = await sb.from("xero_connections").select("id, tenant_id, access_token, refresh_token, expires_at").order("updated_at", { ascending: false }).limit(1).single();
let at = conn.access_token;
if (!conn.expires_at || new Date(conn.expires_at).getTime() < Date.now() + 60_000) { const res = await fetch("https://identity.xero.com/connect/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", Authorization: "Basic " + Buffer.from(`${env.XERO_CLIENT_ID}:${env.XERO_CLIENT_SECRET}`).toString("base64") }, body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: conn.refresh_token }) }); const tok = await res.json(); if (!res.ok) { console.error("refresh failed"); process.exit(1); } at = tok.access_token; await sb.from("xero_connections").update({ access_token: tok.access_token, refresh_token: tok.refresh_token ?? conn.refresh_token, expires_at: new Date(Date.now() + (tok.expires_in ?? 1800) * 1000).toISOString(), updated_at: new Date().toISOString() }).eq("id", conn.id); }
const H = { Authorization: `Bearer ${at}`, "Xero-tenant-id": conn.tenant_id, Accept: "application/json" };
const x = async (p) => { const r = await fetch("https://api.xero.com/api.xro/2.0/" + p, { headers: H }); const t = await r.text(); if (!r.ok) throw new Error(`${p.split("?")[0]} ${r.status} ${t.slice(0, 160)}`); return JSON.parse(t); };
const pages = async (path, key) => { const out = []; for (let p = 1; p <= 8; p++) { const j = await x(`${path}&page=${p}`); const a = j[key] || []; out.push(...a); if (a.length < 100) break; } return out; };
const pd = (d) => { const m = /\/Date\((\d+)/.exec(d || ""); return m ? new Date(+m[1]).toISOString().slice(0, 10) : String(d || "").slice(0, 10); };
const days = (a, b) => Math.round((new Date(b) - new Date(a)) / 86400e3);
const W = encodeURIComponent, D = `DateTime(${since.replace(/-/g, ",")})`;
const accounts = (await x(`Accounts?where=${W('Type=="BANK"')}`)).Accounts;
const drafts = (await pages(`Invoices?where=${W('Type=="ACCPAY" AND Status=="DRAFT"')}&order=Date`, "Invoices")).map((i) => ({ date: pd(i.Date), supplier: i.Contact?.Name || "", number: i.InvoiceNumber || "", total: Number(i.Total), code: (i.LineItems || []).map((l) => l.AccountCode).filter(Boolean).join(","), id: i.InvoiceID }));
const pays = (await pages(`Payments?where=${W(`Date>=${D}`)}&order=Date`, "Payments"));
const { data: snaps } = await sb.from("receipts").select("created_at,vendor,amount,receipt_date,ocr_status,email_sent,storage_path,source").gte("created_at", since).order("created_at", { ascending: false });
const used = new Set(); const wb = xlsx.utils.book_new(); const summary = [];
for (const code of CODES) {
  const acct = accounts.find((a) => a.Code === code); if (!acct) { console.error(`no bank account ${code}`); continue; }
  const tx = (await pages(`BankTransactions?where=${W(`BankAccount.Code=="${code}" AND Date>=${D}`)}&order=Date`, "BankTransactions")).filter((t) => t.Status === "AUTHORISED").map((t) => ({ date: pd(t.Date), payee: t.Contact?.Name || "", desc: (t.LineItems || []).map((l) => l.Description || "").filter(Boolean).join(" | "), code: (t.LineItems || []).map((l) => l.AccountCode).filter(Boolean).join(","), amount: Number(t.Total) * (t.Type.startsWith("SPEND") ? -1 : 1), type: t.Type, rec: !!t.IsReconciled, attach: !!t.HasAttachments }));
  const bp = pays.filter((p) => p.Account?.Code === code).map((p) => ({ date: pd(p.Date), payee: p.Invoice?.Contact?.Name || "", desc: `Bill ${p.Invoice?.InvoiceNumber || ""}`, code: "", amount: Number(p.Amount) * (p.PaymentType === "ACCPAYPAYMENT" ? -1 : 1), type: p.PaymentType, rec: !!p.IsReconciled, attach: !!p.Invoice?.HasAttachments }));
  const rows = [...tx, ...bp].sort((a, b) => b.date.localeCompare(a.date)).map((t) => { const amt = Math.abs(t.amount); const d = drafts.find((q) => !used.has(q.id) && Math.abs(q.total - amt) < 0.005 && Math.abs(days(q.date, t.date)) <= 5); if (d) used.add(d.id); const s = (snaps || []).find((q) => q.amount && Math.abs(Number(q.amount) - amt) < 0.005 && Math.abs(days(q.created_at.slice(0, 10), t.date)) <= 7);
    return { Date: t.date, Payee: t.payee, Description: t.desc, Amount: t.amount, "Account code": t.code, "Reconciled in Xero": t.rec ? "yes" : "NO", "Receipt attached in Xero": t.attach ? "yes" : "no", "Receipt found (Xero draft bill)": d ? `${d.supplier} ${d.number} $${d.total} (${d.date})` : "", "Snap upload (same amount)": s ? `${s.created_at.slice(0, 10)} ${s.vendor || ""}` : "", Done: "" }; });
  const ws = xlsx.utils.json_to_sheet(rows); ws["!cols"] = [{ wch: 11 }, { wch: 28 }, { wch: 40 }, { wch: 11 }, { wch: 9 }, { wch: 12 }, { wch: 14 }, { wch: 44 }, { wch: 26 }, { wch: 8 }];
  xlsx.utils.book_append_sheet(wb, ws, `${code} ${acct.Name}`.slice(0, 31)); summary.push(`${code} ${acct.Name}: ${rows.length} transactions, ${rows.filter((r) => r["Receipt attached in Xero"] === "no").length} without a receipt attached, ${rows.filter((r) => r["Reconciled in Xero"] === "NO").length} unreconciled`);
}
const w2 = xlsx.utils.json_to_sheet(drafts.map((d) => ({ Date: d.date, Supplier: d.supplier, Number: d.number, Total: d.total, "Account code": d.code, "Matched to a card transaction": used.has(d.id) ? "yes" : "", Note: d.supplier === "No Contact" ? "supplier missing" : "" }))); w2["!cols"] = [{ wch: 11 }, { wch: 34 }, { wch: 16 }, { wch: 11 }, { wch: 9 }, { wch: 22 }, { wch: 18 }]; xlsx.utils.book_append_sheet(wb, w2, "Receipts in Xero (drafts)");
const w3 = xlsx.utils.json_to_sheet((snaps || []).map((s) => ({ Uploaded: s.created_at.slice(0, 16).replace("T", " "), Vendor: s.vendor || "", Amount: s.amount || "", "Receipt date": s.receipt_date || "", "Read by OCR": s.ocr_status || "", "Sent to Xero": s.email_sent ? "yes" : "no", Source: s.source, File: s.storage_path }))); w3["!cols"] = [{ wch: 17 }, { wch: 24 }, { wch: 10 }, { wch: 12 }, { wch: 10 }, { wch: 11 }, { wch: 7 }, { wch: 34 }]; xlsx.utils.book_append_sheet(wb, w3, "Snap uploads");
const f = `${process.env.HOME}/Downloads/receipts-to-reconcile-${new Date().toISOString().slice(0, 10)}.xlsx`; xlsx.writeFile(wb, f);
console.log(summary.join("\n")); console.log(`drafts ${drafts.length} (matched ${used.size}), snaps ${(snaps || []).length}\n${f}`);
