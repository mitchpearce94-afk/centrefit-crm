// One-off: preview all four CRM emails by sending them with sample data.
// Uses the same brand helpers as the production routes so what you receive
// is byte-identical to what real users would receive (minus the dynamic
// content). No DB writes — Resend send only.

import { Resend } from "resend";
import fs from "node:fs";
import path from "node:path";

// Load env from temp pull file
const envPath = process.env.PREVIEW_ENV_PATH || path.join(process.env.LOCALAPPDATA || "/tmp", "Temp", "preview.env");
const envText = fs.readFileSync(envPath, "utf-8");
const env = {};
for (const line of envText.split(/\r?\n/)) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)="?(.*?)"?$/);
  if (m) env[m[1]] = m[2];
}
const RESEND_KEY = env.RESEND_API_KEY;
const APP_URL = env.NEXT_PUBLIC_APP_URL || "https://crm.centrefit.com.au";
const TO = "mitchpearce94@gmail.com";

if (!RESEND_KEY) throw new Error("RESEND_API_KEY missing");

// Inline the brand helpers (verbatim copy of src/lib/emails/brand.ts so
// what's sent matches production output exactly).
function emailHeader(opts) {
  const rightTable = opts?.rightLabel
    ? `
      <table align="right" border="0" cellpadding="0" cellspacing="0" role="presentation" style="float:right">
        <tr><td align="right" style="text-align:right;white-space:nowrap;padding-top:6px">
          <p style="font-size:10px;color:#94a3b8;margin:0;letter-spacing:1.5px;text-transform:uppercase;font-weight:700">${opts.rightLabel}</p>
          ${opts.rightValue ? `<p style="font-size:16px;font-weight:700;color:#60a5fa;margin:3px 0 0;font-family:'Consolas','SF Mono',monospace">${opts.rightValue}</p>` : ""}
        </td></tr>
      </table>`
    : "";
  return `
    <tr><td style="background:linear-gradient(135deg,#0f172a,#1e293b);padding:24px 32px;color:#ffffff">
      <table align="left" border="0" cellpadding="0" cellspacing="0" role="presentation" style="float:left">
        <tr><td valign="bottom" style="vertical-align:bottom">
          <img src="${APP_URL}/centrefit-logo-white.png" alt="Centrefit Group" height="36" style="display:block;height:36px;width:auto;border:0" />
        </td></tr>
      </table>
      ${rightTable}
      <div style="clear:both;line-height:0;font-size:0">&nbsp;</div>
    </td></tr>`;
}

function emailFooter(extra) {
  return `
    <tr><td style="background:#f8fafc;border-top:1px solid #e2e8f0;padding:18px 32px;text-align:center">
      <p style="font-size:11px;color:#475569;margin:0;font-weight:600">Centrefit Group Pty Ltd</p>
      <p style="font-size:10px;color:#94a3b8;margin:3px 0 0">ABN 55 168 413 161 · 1/25 Paisley Drive, Lawnton QLD 4501 · (07) 3188 5115</p>
      ${extra ? `<p style="font-size:10px;color:#94a3b8;margin:6px 0 0">${extra}</p>` : ""}
    </td></tr>`;
}

function emailLayout(content) {
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:'Segoe UI',system-ui,-apple-system,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:32px 16px">
<tr><td align="center">
<table width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.1)">
${content}
</table>
</td></tr>
</table>
</body>
</html>`;
}

const resend = new Resend(RESEND_KEY);

// ── 1. Quote email (matches /api/quotes/send body)
const quoteHtml = emailLayout(`
  ${emailHeader({ rightLabel: "Quotation", rightValue: "CF-2026-PREVIEW" })}
  <tr><td style="padding:32px 32px 12px">
    <h1 style="font-size:20px;font-weight:600;color:#0f172a;margin:0 0 4px;letter-spacing:-0.3px">Your Centrefit quote is ready</h1>
    <p style="font-size:13px;color:#475569;margin:14px 0 0;line-height:1.6">Hi Mitchell,</p>
    <p style="font-size:13px;color:#475569;margin:10px 0 0;line-height:1.6">
      Thanks for the opportunity to quote <strong>Snap Fitness Indooroopilly</strong>. Your detailed quotation is attached as a PDF and is also available online via the link below — including the full scope of works, pricing breakdown, ongoing costs and applicable standards.
    </p>
    <p style="font-size:13px;color:#475569;margin:10px 0 0;line-height:1.6">
      Please review the attached PDF, then click below to view it online and accept or decline.
    </p>
  </td></tr>
  <tr><td style="padding:0 32px 8px">
    <p style="font-size:11px;color:#94a3b8;margin:0;line-height:1.5">Snap Fitness Indooroopilly · 248 Moggill Rd, Indooroopilly QLD 4068</p>
  </td></tr>
  <tr><td align="center" style="padding:28px 32px 8px;text-align:center">
    <a href="${APP_URL}/quote-response/preview" style="display:inline-block;background:#3b82f6;color:#ffffff;text-align:center;padding:14px 28px;border-radius:10px;font-size:14px;font-weight:700;text-decoration:none;letter-spacing:0.3px">
      View Quote &amp; Respond Online
    </a>
    <p style="font-size:11px;color:#94a3b8;margin:14px 0 0;text-align:center;line-height:1.5">
      You can review the full quote and accept or decline at the link above. Valid for 30 days.
    </p>
  </td></tr>
  ${emailFooter("Reply to this email if you have any questions.")}
`);

// ── 2. Staff invite (matches /api/staff/invite body)
const tempPwd = "harbour-summit-1742";
const loginUrl = `${APP_URL}/login`;
const inviteHtml = emailLayout(`
  ${emailHeader({ rightLabel: "CRM Invite" })}
  <tr><td style="padding:32px 32px 8px">
    <h1 style="font-size:20px;font-weight:600;color:#0f172a;margin:0 0 8px">You're invited to the Centrefit CRM</h1>
    <p style="margin:0 0 16px;font-size:13px;color:#475569;line-height:1.55">Mitchell Pearce added you to the Centrefit CRM as <strong>Field Staff</strong>.</p>

    <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:18px;margin:18px 0">
      <p style="margin:0 0 4px;font-size:11px;text-transform:uppercase;letter-spacing:1px;color:#64748b;font-weight:700">Login URL</p>
      <p style="margin:0 0 14px;font-family:monospace;font-size:13px;color:#0f172a">${loginUrl}</p>
      <p style="margin:0 0 4px;font-size:11px;text-transform:uppercase;letter-spacing:1px;color:#64748b;font-weight:700">Email</p>
      <p style="margin:0 0 14px;font-family:monospace;font-size:13px;color:#0f172a">${TO}</p>
      <p style="margin:0 0 4px;font-size:11px;text-transform:uppercase;letter-spacing:1px;color:#64748b;font-weight:700">Temporary password</p>
      <p style="margin:0;font-family:monospace;font-size:16px;font-weight:600;color:#0f172a;letter-spacing:0.5px">${tempPwd}</p>
    </div>

    <p style="margin:16px 0;text-align:center">
      <a href="${loginUrl}" style="display:inline-block;background:#3b82f6;color:#ffffff;padding:12px 24px;border-radius:10px;text-decoration:none;font-weight:700;font-size:14px">Sign in to the CRM</a>
    </p>

    <p style="margin:24px 0 0;font-size:11px;color:#94a3b8;text-align:center;line-height:1.5">
      You'll be prompted to set a new password on first login. If you weren't expecting this, ignore this email or reply to let us know.
    </p>
  </td></tr>
  ${emailFooter()}
`);

// ── 3. Forgot-password (matches /api/auth/forgot-password body)
const forgotHtml = emailLayout(`
  ${emailHeader({ rightLabel: "Password Reset" })}
  <tr><td style="padding:32px 32px 8px">
    <h1 style="font-size:20px;font-weight:600;color:#0f172a;margin:0 0 8px">Centrefit CRM password reset</h1>
    <p style="margin:0 0 16px;font-size:13px;color:#475569;line-height:1.55">Someone (hopefully you) requested a password reset on your Centrefit CRM account.</p>

    <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:18px;margin:18px 0">
      <p style="margin:0 0 4px;font-size:11px;text-transform:uppercase;letter-spacing:1px;color:#64748b;font-weight:700">Login URL</p>
      <p style="margin:0 0 14px;font-family:monospace;font-size:13px;color:#0f172a">${loginUrl}</p>
      <p style="margin:0 0 4px;font-size:11px;text-transform:uppercase;letter-spacing:1px;color:#64748b;font-weight:700">Email</p>
      <p style="margin:0 0 14px;font-family:monospace;font-size:13px;color:#0f172a">${TO}</p>
      <p style="margin:0 0 4px;font-size:11px;text-transform:uppercase;letter-spacing:1px;color:#64748b;font-weight:700">Temporary password</p>
      <p style="margin:0;font-family:monospace;font-size:16px;font-weight:600;color:#0f172a;letter-spacing:0.5px">harbour-summit-1742</p>
    </div>

    <p style="margin:16px 0;text-align:center">
      <a href="${loginUrl}" style="display:inline-block;background:#3b82f6;color:#ffffff;padding:12px 24px;border-radius:10px;text-decoration:none;font-weight:700;font-size:14px">Sign in to the CRM</a>
    </p>

    <p style="margin:24px 0 0;font-size:11px;color:#94a3b8;text-align:center;line-height:1.5">
      You'll be prompted to choose a new password right after signing in. If you didn't request this, your old password still works as long as you don't sign in with the temporary one — let an admin know.
    </p>
  </td></tr>
  ${emailFooter()}
`);

// ── 4. Supplier RFQ (matches /lib/emails/supplier-rfq body)
const REPLY_TO = "accounts@centrefit.com.au";
const sampleLines = [
  { name: "DGS-1210-52MP", sku: "DGS-1210-52MP", qty: 1 },
  { name: "Cat6 UTP Cable 305m", sku: "ECC6UB305B", qty: 4 },
  { name: "16CH NVR", sku: "NVR4216-16P-A", qty: 1 },
  { name: "FHD LED Monitor", sku: "DHI-LM22-H200", qty: 1 },
];
const rfqRows = sampleLines.map((l) => `
  <tr>
    <td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;color:#111827">${l.name}<br/><span style="font-family:'SF Mono',Consolas,monospace;font-size:12px;color:#6b7280">${l.sku}</span></td>
    <td style="padding:10px 12px;border-bottom:1px solid #e5e7eb;text-align:right;font-family:'SF Mono',Consolas,monospace;color:#111827">${l.qty}</td>
  </tr>`).join("");
const rfqHtml = emailLayout(`
  ${emailHeader({ rightLabel: "Pricing Request", rightValue: "CF-2026-PREVIEW" })}
  <tr><td style="padding:32px 32px 8px">
    <h1 style="margin:0 0 4px;font-size:20px;font-weight:600;color:#0f172a">Pricing request</h1>
    <p style="margin:0 0 20px;color:#6b7280;font-size:12px">
      Quote CF-2026-PREVIEW · Snap Fitness Indooroopilly
    </p>
    <p style="margin:0 0 14px;font-size:13px;line-height:1.55;color:#475569">Hi Acme Supplies,</p>
    <p style="margin:0 0 14px;font-size:13px;line-height:1.55;color:#475569">
      We're preparing a quote for our client and need your current pricing on the items below.
      Please reply to this email with your current unit pricing and lead time / availability per line.
      If anything is discontinued or backordered, an alternative would be appreciated.
    </p>
    <p style="margin:0 0 16px;color:#374151;font-size:13px"><strong>Please reply by:</strong> 2 May 2026</p>
    <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="border-collapse:collapse;border:1px solid #e5e7eb;border-radius:6px;overflow:hidden;margin:8px 0 18px">
      <thead>
        <tr style="background:#f9fafb">
          <th style="text-align:left;padding:10px 12px;border-bottom:1px solid #e5e7eb;font-weight:700;color:#6b7280;text-transform:uppercase;font-size:11px;letter-spacing:0.04em">Item</th>
          <th style="text-align:right;padding:10px 12px;border-bottom:1px solid #e5e7eb;font-weight:700;color:#6b7280;text-transform:uppercase;font-size:11px;letter-spacing:0.04em;width:80px">Qty</th>
        </tr>
      </thead>
      <tbody>${rfqRows}</tbody>
    </table>
    <p style="margin:0 0 6px;font-size:11px;color:#6b7280;line-height:1.5">
      Please reply directly to this email so our accounts team can match your response to this quote.
    </p>
    <p style="margin:0 0 8px;font-size:11px;color:#6b7280;line-height:1.5">
      This is a pricing request, not an order. A formal purchase order will follow once our client approves the quote.
    </p>
  </td></tr>
  ${emailFooter(`Reply to <a href="mailto:${REPLY_TO}" style="color:#2563eb;text-decoration:none">${REPLY_TO}</a>`)}
`);

// ── Send all four ──
const sends = [
  { from: "Centrefit Quotes <quotes@centrefit.com.au>",      subject: "[PREVIEW] Quotation CF-2026-PREVIEW — Snap Fitness Indooroopilly", html: quoteHtml },
  { from: "Centrefit CRM <noreply@centrefit.com.au>",        subject: "[PREVIEW] Your Centrefit CRM invitation",                          html: inviteHtml },
  { from: "Centrefit CRM <noreply@centrefit.com.au>",        subject: "[PREVIEW] Centrefit CRM password reset",                           html: forgotHtml },
  { from: "Centrefit Procurement <procurement@centrefit.com.au>", subject: "[PREVIEW] Pricing request — CentreFit Quote CF-2026-PREVIEW", html: rfqHtml },
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const arg = process.argv[2];
const queue = arg === "--rfq-only" ? sends.slice(3) : sends;
for (const s of queue) {
  const { data, error } = await resend.emails.send({
    from: s.from,
    to: TO,
    subject: s.subject,
    html: s.html,
  });
  if (error) console.error("FAIL:", s.subject, error);
  else console.log("SENT:", s.subject, "→ id", data?.id);
  await sleep(700); // stay under Resend's 2/sec limit
}
