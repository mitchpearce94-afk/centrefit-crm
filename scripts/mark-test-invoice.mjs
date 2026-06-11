// $5 demo invoice to Mark Pearce (Mitchell-requested 2026-06-11) — exercises
// the full pipeline: CRM record + Xero invoice + online-pay link (Apple Pay)
// + branded email from accounts@.
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const env = Object.fromEntries(
  readFileSync(new URL("../.env.gc-probe", import.meta.url), "utf8")
    .split("\n").filter((l) => l.includes("="))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, "").replace(/\\r|\\n/g, "").trim()]; }),
);
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const MARK_EMAIL = "mark@centrefit.com.au";
const MARK_CRM_ID = "9dc08fd0-ad7a-4ef5-ac69-15ca9538249a";
const MARK_XERO_ID = "d2d85458-c439-4533-afbc-6225507f09de";

// ── Xero auth ────────────────────────────────────────────────────────────────
const { data: conn } = await sb.from("xero_connections").select("id, tenant_id, access_token, refresh_token, expires_at").order("updated_at", { ascending: false }).limit(1).single();
let tok = conn.access_token;
if (!conn.expires_at || new Date(conn.expires_at).getTime() < Date.now() + 60000) {
  const res = await fetch("https://identity.xero.com/connect/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Authorization: "Basic " + Buffer.from(`${env.XERO_CLIENT_ID}:${env.XERO_CLIENT_SECRET}`).toString("base64") },
    body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: conn.refresh_token }),
  });
  const t = await res.json();
  tok = t.access_token;
  await sb.from("xero_connections").update({ access_token: t.access_token, refresh_token: t.refresh_token ?? conn.refresh_token, expires_at: new Date(Date.now() + (t.expires_in ?? 1800) * 1000).toISOString(), updated_at: new Date().toISOString() }).eq("id", conn.id);
}
const XH = { Authorization: `Bearer ${tok}`, "Xero-tenant-id": conn.tenant_id, Accept: "application/json", "Content-Type": "application/json" };
async function xero(path, method = "GET", body) {
  const res = await fetch(`https://api.xero.com/api.xro/2.0/${path}`, { method, headers: XH, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let j = null; try { j = text ? JSON.parse(text) : null; } catch { /* */ }
  if (!res.ok) throw new Error(`${method} ${path} → HTTP ${res.status}: ${(j?.Elements?.[0]?.ValidationErrors?.map((v) => v.Message).join("; ")) ?? text.slice(0, 200)}`);
  return j;
}

// ── 1. email on both contact records ─────────────────────────────────────────
await sb.from("customers").update({ billing_email: MARK_EMAIL, xero_contact_id: MARK_XERO_ID, updated_at: new Date().toISOString() }).eq("id", MARK_CRM_ID);
await xero(`Contacts/${MARK_XERO_ID}`, "POST", { Contacts: [{ ContactID: MARK_XERO_ID, EmailAddress: MARK_EMAIL }] });
console.log("1. Mark's email set on CRM customer + Xero contact");

// ── 2. create + authorise the Xero invoice ───────────────────────────────────
const due = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
const inv = (await xero("Invoices", "POST", {
  Invoices: [{
    Type: "ACCREC",
    Contact: { ContactID: MARK_XERO_ID },
    Date: new Date().toISOString().slice(0, 10),
    DueDate: due,
    LineAmountTypes: "Inclusive",
    Reference: "CRM payment demo",
    Status: "AUTHORISED",
    LineItems: [{ Description: "CRM payment system demo — testing online payment (try Apple Pay!)", Quantity: 1, UnitAmount: 5, AccountCode: "200", TaxType: "OUTPUT" }],
  }],
})).Invoices[0];
console.log(`2. Xero invoice ${inv.InvoiceNumber} AUTHORISED — $${inv.Total}`);

// ── 3. online pay URL ────────────────────────────────────────────────────────
const online = (await xero(`Invoices/${inv.InvoiceID}/OnlineInvoice`)).OnlineInvoices?.[0]?.OnlineInvoiceUrl ?? null;
console.log(`3. online invoice URL: ${online ?? "NOT AVAILABLE"}`);

// ── 4. CRM record ────────────────────────────────────────────────────────────
const { data: row, error: insErr } = await sb.from("invoices").insert({
  invoice_type: "adhoc",
  customer_id: MARK_CRM_ID,
  description: "CRM payment system demo",
  line_items: [{ description: "CRM payment system demo — testing online payment (try Apple Pay!)", quantity: 1, unitAmount: 5 }],
  subtotal: 4.55, gst: 0.45, total: 5, amount_due: 5,
  status: "authorised",
  xero_invoice_id: inv.InvoiceID,
  xero_invoice_number: inv.InvoiceNumber,
  xero_online_url: online,
  issued_at: new Date().toISOString(),
  due_date: due,
  xero_last_synced_at: new Date().toISOString(),
}).select("id").single();
if (insErr) throw new Error(`CRM insert failed: ${insErr.message}`);
console.log(`4. CRM invoice row ${row.id}`);

// ── 5. branded email (mirror of lib/emails/invoice-send.ts) ─────────────────
const APP_URL = "https://crm.centrefit.com.au";
const payButton = online ? `
  <tr><td align="center" style="padding:28px 32px 8px;text-align:center">
    <a href="${online}" style="display:inline-block;background:#3b82f6;color:#ffffff;text-align:center;padding:14px 28px;border-radius:10px;font-size:14px;font-weight:700;text-decoration:none;letter-spacing:0.3px">View &amp; Pay Invoice</a>
    <p style="font-size:11px;color:#94a3b8;margin:14px 0 0;text-align:center;line-height:1.5">Secure online payment via Xero — card or Apple Pay.</p>
  </td></tr>` : "";
const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:'Segoe UI',system-ui,-apple-system,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:32px 16px"><tr><td align="center">
<table width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.1)">
  <tr><td style="background:linear-gradient(135deg,#0f172a,#1e293b);padding:24px 32px;color:#ffffff">
    <table align="left" border="0" cellpadding="0" cellspacing="0" role="presentation" style="float:left"><tr><td valign="bottom" style="vertical-align:bottom">
      <img src="${APP_URL}/centrefit-logo-white.png" alt="Centrefit Group" height="36" style="display:block;height:36px;width:auto;border:0" />
    </td></tr></table>
    <table align="right" border="0" cellpadding="0" cellspacing="0" role="presentation" style="float:right"><tr><td align="right" style="text-align:right;white-space:nowrap;padding-top:6px">
      <p style="font-size:10px;color:#94a3b8;margin:0;letter-spacing:1.5px;text-transform:uppercase;font-weight:700">Invoice</p>
      <p style="font-size:16px;font-weight:700;color:#60a5fa;margin:3px 0 0;font-family:'Consolas','SF Mono',monospace">${inv.InvoiceNumber}</p>
    </td></tr></table>
    <div style="clear:both;line-height:0;font-size:0">&nbsp;</div>
  </td></tr>
  <tr><td style="padding:32px 32px 12px">
    <h1 style="font-size:20px;font-weight:600;color:#0f172a;margin:0 0 4px;letter-spacing:-0.3px">Invoice from Centrefit</h1>
    <p style="font-size:13px;color:#475569;margin:14px 0 0;line-height:1.6">Hi Mark,</p>
    <p style="font-size:13px;color:#475569;margin:10px 0 0;line-height:1.6">Here's your invoice. Total: <strong>$5.00</strong>, due <strong>${new Date(due).toLocaleDateString("en-AU", { day: "numeric", month: "long", year: "numeric" })}</strong>.</p>
    <p style="font-size:13px;color:#475569;margin:10px 0 0;line-height:1.6">You can pay online via the link below — tap it on your phone and you'll see Apple Pay.</p>
  </td></tr>
  ${payButton}
  <tr><td style="background:#f8fafc;border-top:1px solid #e2e8f0;padding:18px 32px;text-align:center">
    <p style="font-size:11px;color:#475569;margin:0;font-weight:600">Centrefit Group Pty Ltd</p>
    <p style="font-size:10px;color:#94a3b8;margin:3px 0 0">ABN 55 168 413 161 · 1/25 Paisley Drive, Lawnton QLD 4501 · (07) 3188 5115</p>
    <p style="font-size:10px;color:#94a3b8;margin:6px 0 0">Reply to this email for any account questions.</p>
  </td></tr>
</table></td></tr></table></body></html>`;

const send = await fetch("https://api.resend.com/emails", {
  method: "POST",
  headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
  body: JSON.stringify({
    from: "Centrefit Accounts <accounts@centrefit.com.au>",
    replyTo: "accounts@centrefit.com.au",
    to: [MARK_EMAIL],
    subject: `Invoice ${inv.InvoiceNumber} — Mark Pearce`,
    html,
    headers: { "X-Cf-Doc-Type": "invoice", "X-Cf-Doc-Id": row.id },
  }),
});
const sendJson = await send.json();
if (!send.ok) throw new Error(`email failed: ${JSON.stringify(sendJson)}`);
console.log(`5. emailed ${MARK_EMAIL} (Resend ${sendJson.id})`);

// ── 6. mark sent both sides ──────────────────────────────────────────────────
await sb.from("invoices").update({ sent_at: new Date().toISOString(), sent_to_email: MARK_EMAIL }).eq("id", row.id);
await xero(`Invoices/${inv.InvoiceID}`, "POST", { Invoices: [{ InvoiceID: inv.InvoiceID, SentToContact: true }] });
console.log("6. marked sent in CRM + Xero. Done.");
