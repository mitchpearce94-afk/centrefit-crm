// Email mitchell@ the unbilled-services list from the latest recon report.
// Internal email, Mitchell-requested 2026-06-11.
import { readFileSync } from "node:fs";

const env = Object.fromEntries(
  readFileSync(new URL("../.env.gc-probe", import.meta.url), "utf8")
    .split("\n").filter((l) => l.includes("="))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, "").replace(/\\r|\\n/g, "").trim()];
    }),
);

const md = readFileSync(new URL("./recon-report.md", import.meta.url), "utf8");
let section = md.slice(md.indexOf("## ❌ UNBILLED"));
const nextHeading = section.indexOf("\n## ", 4);
if (nextHeading !== -1) section = section.slice(0, nextHeading);
const lines = section.split("\n").filter((l) => l.startsWith("|")).slice(2);
const rows = lines.map((l) => {
  const c = l.split("|").map((s) => s.trim());
  return { kind: c[1], name: c[2], detail: c[3], est: c[4], near: c[5] };
}).filter((r) => r.name);

const total = rows.reduce((s, r) => s + (Number(r.est?.replace(/[^0-9.]/g, "")) || 0), 0);
const kindLabel = { nbn: "NBN", sim: "SIM", myalarm: "MyAlarm", duress: "Duress", monitoring: "Monitoring" };

const tr = rows.map((r) => `
  <tr>
    <td style="padding:6px 10px;border-bottom:1px solid #e5e7eb;font-size:12px;">${kindLabel[r.kind] ?? r.kind}</td>
    <td style="padding:6px 10px;border-bottom:1px solid #e5e7eb;font-size:12px;font-weight:600;">${r.name}</td>
    <td style="padding:6px 10px;border-bottom:1px solid #e5e7eb;font-size:11px;color:#555;">${r.detail || ""}</td>
    <td style="padding:6px 10px;border-bottom:1px solid #e5e7eb;font-size:12px;text-align:right;">${r.est}</td>
    <td style="padding:6px 10px;border-bottom:1px solid #e5e7eb;font-size:10px;color:#888;">${r.near === "none" ? "" : r.near}</td>
  </tr>`).join("");

const html = `
<div style="font-family:Arial,sans-serif;max-width:760px;">
  <h2 style="font-size:16px;">Unbilled services — ${rows.length} found (≈ $${total.toFixed(2)}/month)</h2>
  <p style="font-size:13px;color:#333;">Services Centrefit pays for (Kinetix / M2M / Sentinel) with no matching DD plan or authorised Xero repeating invoice. Source: Direct Debiting 240426.xlsx vs CRM plans + Xero, reconciled 11/06/2026. Wagga Wagga has been resolved (Puntarungsy site renamed — billing was there all along). Personal/family lines (Sue Pearce, Mark Pearce, Allan Bowman, etc.) are included — your call whether they get billed or stay comped.</p>
  <table style="border-collapse:collapse;width:100%;">
    <thead>
      <tr style="text-align:left;background:#f3f4f6;font-size:11px;">
        <th style="padding:6px 10px;">Service</th><th style="padding:6px 10px;">Site / Customer</th>
        <th style="padding:6px 10px;">Detail</th><th style="padding:6px 10px;text-align:right;">Est $/mo</th>
        <th style="padding:6px 10px;">Partial match</th>
      </tr>
    </thead>
    <tbody>${tr}</tbody>
  </table>
  <p style="font-size:13px;margin-top:10px;"><strong>Estimated total: $${total.toFixed(2)}/month (~$${Math.round(total * 12).toLocaleString()}/yr)</strong></p>
  <p style="font-size:12px;color:#555;">"Partial match" = the customer has a plan or Xero invoice, but it doesn't include this service — fastest fixes: add the line via the plan's <em>Add service</em> button. No match at all = new plan + signup link, or cancel the service if it shouldn't exist.</p>
  <p style="font-size:11px;color:#888;margin-top:14px;">Full workbook: Downloads\\Billing Reconciliation 2026-06-11.xlsx. Sent from the Centrefit CRM at Mitchell's request.</p>
</div>`;

const res = await fetch("https://api.resend.com/emails", {
  method: "POST",
  headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
  body: JSON.stringify({
    from: "Centrefit CRM <noreply@centrefit.com.au>",
    to: ["mitchell@centrefit.com.au"],
    subject: `[CORRECTED] Unbilled services: ${rows.length} services ≈ $${total.toFixed(0)}/mo (~$${Math.round(total * 12 / 1000)}k/yr) — ignore previous email`,
    html,
  }),
});
const json = await res.json();
if (!res.ok) { console.error("FAILED:", res.status, JSON.stringify(json)); process.exit(1); }
console.log("Sent:", json.id, `— ${rows.length} rows, $${total.toFixed(2)}/mo`);
