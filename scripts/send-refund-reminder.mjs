// One-off: email accounts@ the GC double-charge refund list (Mitchell-requested
// 2026-06-11). Internal email — goes to Centrefit accounts, not a customer.
import { readFileSync } from "node:fs";

const env = Object.fromEntries(
  readFileSync(new URL("../.env.gc-probe", import.meta.url), "utf8")
    .split("\n")
    .filter((l) => l.includes("="))
    .map((l) => {
      const i = l.indexOf("=");
      const v = l.slice(i + 1).trim().replace(/^"|"$/g, "").replace(/\\r|\\n/g, "").trim();
      return [l.slice(0, i).trim(), v];
    }),
);

const rows = [
  { customer: "Ajit Singh", site: "Snap Fitness Point Cook", amount: "$224.25", detail: "Charged twice in June — refund the two duplicate payments", payments: "PM01XJBQSGDWR7DK5J95H3AVT9F5 ($85.25, 3 Jun) and PM01XJBQRW9BKFV2JQC07RR9WG60 ($139.00, 3 Jun)" },
  { customer: "Benjamin Gunning", site: "Snap Fitness Preston", amount: "$85.25", detail: "Charged twice in June — refund the duplicate payment", payments: "PM01XJBQWPE6P5Z231E0YJYQ53X7 ($85.25, 3 Jun)" },
  { customer: "Benjamin Gunning", site: "Snap Fitness Woodend", amount: "$139.00", detail: "Charged twice in June — refund the duplicate payment", payments: "PM01XJG29HCTH4ZD999XYD5PXJ4F ($139.00, 4 Jun)" },
];

const tableRows = rows.map((r) => `
  <tr>
    <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;">${r.customer}</td>
    <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;">${r.site}</td>
    <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;font-weight:600;">${r.amount}</td>
    <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;font-size:12px;color:#555;">${r.detail}<br><span style="font-family:monospace;font-size:11px;">${r.payments}</span></td>
  </tr>`).join("");

const html = `
<div style="font-family:Arial,sans-serif;max-width:640px;">
  <h2 style="font-size:16px;">Refunds due — GoCardless double-charges (June 2026)</h2>
  <p style="font-size:13px;color:#333;">Three sites were double-charged in early June (manual GC subscriptions created 2–3 Jun overlapped with the CRM's automatic activation on 5–9 Jun). The duplicate subscriptions were cancelled on 11 Jun — these are the refunds owed. Refund the listed payment IDs in the GoCardless dashboard (Payments → search the ID → Refund).</p>
  <table style="border-collapse:collapse;width:100%;font-size:13px;">
    <thead>
      <tr style="text-align:left;background:#f3f4f6;">
        <th style="padding:8px 12px;">Customer</th>
        <th style="padding:8px 12px;">Site</th>
        <th style="padding:8px 12px;">Refund</th>
        <th style="padding:8px 12px;">Payment(s) to refund</th>
      </tr>
    </thead>
    <tbody>${tableRows}</tbody>
  </table>
  <p style="font-size:13px;margin-top:12px;"><strong>Total: $448.50</strong></p>
  <p style="font-size:11px;color:#888;margin-top:16px;">Sent from the Centrefit CRM at Mitchell's request — duplicate-billing cleanup 11/06/2026.</p>
</div>`;

const res = await fetch("https://api.resend.com/emails", {
  method: "POST",
  headers: {
    Authorization: `Bearer ${env.RESEND_API_KEY}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    from: "Centrefit CRM <noreply@centrefit.com.au>",
    to: ["accounts@centrefit.com.au"],
    subject: "Refunds due: GC double-charges — Ajit $224.25, Ben Gunning $224.25 (total $448.50)",
    html,
  }),
});
const json = await res.json();
if (!res.ok) {
  console.error("FAILED:", res.status, JSON.stringify(json));
  process.exit(1);
}
console.log("Sent:", json.id);
