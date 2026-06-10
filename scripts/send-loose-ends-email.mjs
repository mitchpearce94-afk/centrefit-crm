// Email mitchell@ the billing-cleanup action list (requested 2026-06-11).
import { readFileSync } from "node:fs";

const env = Object.fromEntries(
  readFileSync(new URL("../.env.gc-probe", import.meta.url), "utf8")
    .split("\n").filter((l) => l.includes("="))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, "").replace(/\\r|\\n/g, "").trim()]; }),
);

const html = `
<div style="font-family:Arial,sans-serif;max-width:680px;font-size:13px;color:#222;">
  <h2 style="font-size:16px;">Billing cleanup — outstanding actions (11/06/2026)</h2>

  <h3 style="font-size:14px;margin-bottom:4px;">1. Xero GoCardless app — unlink 2 contacts (2 min, your login)</h3>
  <p style="margin-top:0;">These two are the only genuine recurring double-collects found in the full scan. In Xero &rarr; GoCardless app settings, unlink auto-collect for:</p>
  <ul style="margin-top:4px;">
    <li><strong>Tahlia Puntarbello Snap Fitness Estella</strong> — B2B $60.50/mo collected twice in May; June duplicate caught &amp; cancelled in flight</li>
    <li><strong>Snap Fitness Newtown</strong> — Duress SIM $24.75 collected twice on 9 Jun</li>
  </ul>
  <p style="font-size:12px;color:#555;">One-off job invoices auto-collecting via DD on the other 13 linked contacts is fine — leave those.</p>

  <h3 style="font-size:14px;margin-bottom:4px;">2. Refunds / credits owed</h3>
  <table style="border-collapse:collapse;font-size:13px;">
    <tr><td style="padding:4px 12px 4px 0;">Ajit Singh — Point Cook</td><td style="padding:4px 0;"><strong>$224.25</strong> (payment IDs in the accounts@ email)</td></tr>
    <tr><td style="padding:4px 12px 4px 0;">Ben Gunning — Preston + Woodend</td><td style="padding:4px 0;"><strong>$224.25</strong> (payment IDs in the accounts@ email)</td></tr>
    <tr><td style="padding:4px 12px 4px 0;">Puntarungsy — Estella (May B2B dupe)</td><td style="padding:4px 0;"><strong>$60.50</strong> (PM01XJ… 11 May, or credit next invoice)</td></tr>
    <tr><td style="padding:4px 12px 4px 0;">Joseph Zhou — Newtown (Jun SIM dupe)</td><td style="padding:4px 0;"><strong>$24.75</strong> (INV-5819 collection, or credit next invoice)</td></tr>
    <tr><td style="padding:6px 12px 4px 0;border-top:1px solid #ddd;"><strong>Total</strong></td><td style="padding:6px 0 4px;border-top:1px solid #ddd;"><strong>$533.75</strong></td></tr>
  </table>

  <h3 style="font-size:14px;margin-bottom:4px;">3. Xero housekeeping</h3>
  <ul style="margin-top:4px;">
    <li><strong>INV-5863</strong> (Estella, $60.50, 11 Jun) — the duplicate GC collection was cancelled, so it shows unpaid. Reconcile it against the subscription payment of the same day.</li>
  </ul>

  <h3 style="font-size:14px;margin-bottom:4px;">4. Newtown VOIP — once Joseph pays the arrears</h3>
  <ol style="margin-top:4px;">
    <li>You're chasing the unpaid VOIP invoices (in progress; auto-reminder cron is also on it)</li>
    <li>Open his Newtown plan in the CRM &rarr; <em>Add service</em> &rarr; VOIP Phone Service $66/mo &rarr; confirm (goes on his existing mandate, nothing for him to sign)</li>
    <li>Then delete the $66 VOIP repeating invoice in Xero — Claude can do this on request</li>
  </ol>

  <h3 style="font-size:14px;margin-bottom:4px;">Done today, for reference</h3>
  <ul style="margin-top:4px;font-size:12px;color:#555;">
    <li>Kellyville consolidated: legacy subs cancelled, MyAlarm re-dated to 22 Sep, duplicate Xero RIs deleted — North Kellyville plan is the single source from 16 Jun</li>
    <li>5 duplicate subs cancelled (Point Cook ×2, Preston ×2, Woodend)</li>
    <li>Weekly NBN billing watchdog live (Mondays 7:30am — bell+email on unbilled circuits)</li>
    <li>Unbilled-services audit emailed: 62 services ≈ $4,151/mo</li>
    <li>Site transfer + customer Direct Debits tab live in the CRM</li>
  </ul>

  <p style="font-size:11px;color:#888;margin-top:14px;">Sent from the Centrefit CRM at Mitchell's request.</p>
</div>`;

const res = await fetch("https://api.resend.com/emails", {
  method: "POST",
  headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
  body: JSON.stringify({
    from: "Centrefit CRM <noreply@centrefit.com.au>",
    to: ["mitchell@centrefit.com.au"],
    subject: "Billing cleanup — action list: 2 contacts to unlink, $533.75 refunds, Newtown VOIP steps",
    html,
  }),
});
const json = await res.json();
if (!res.ok) { console.error("FAILED:", res.status, JSON.stringify(json)); process.exit(1); }
console.log("Sent:", json.id);
