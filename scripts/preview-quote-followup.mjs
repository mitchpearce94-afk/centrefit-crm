// One-off: send a sample of the 7-day quote-followup email so Mitchell
// can see what customers receive. Mirrors the production template in
// src/lib/emails/quote-followup.ts and src/lib/emails/brand.ts byte-for-byte.
//
// Usage:
//   node scripts/preview-quote-followup.mjs
// (loads RESEND_API_KEY + NEXT_PUBLIC_APP_URL from .env.local)

import { Resend } from "resend";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const envPath = process.env.PREVIEW_ENV_PATH || path.resolve(__dirname, "..", ".env.local");
const envText = fs.readFileSync(envPath, "utf-8");
const env = {};
for (const line of envText.split(/\r?\n/)) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (m) env[m[1]] = m[2].replace(/^"(.*)"$/, "$1");
}

const RESEND_KEY = env.RESEND_API_KEY;
const APP_URL = env.NEXT_PUBLIC_APP_URL || "https://crm.centrefit.com.au";
const TO = process.argv[2] || "mitchell@centrefit.com.au";
if (!RESEND_KEY) throw new Error("RESEND_API_KEY missing from .env.local");

// Inline brand helpers — verbatim from src/lib/emails/brand.ts
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

// Mock data — realistic enough to look like the real thing
const input = {
  to: TO,
  quoteRef: "CF-2026-0019",
  quoteId: "00000000-0000-0000-0000-000000000019",
  customerName: "Snap Fitness Samford",
  contactFirstName: "Mitchell",
  siteName: "Snap Fitness Samford",
  respondUrl: `${APP_URL}/quote-response/preview-token-not-real`,
  daysSinceSent: 7,
};

const greeting = input.contactFirstName ? `Hi ${input.contactFirstName},` : "Hi,";

const html = emailLayout(`
    ${emailHeader({ rightLabel: "Quotation", rightValue: input.quoteRef })}

    <tr><td style="padding:32px 32px 12px">
      <h1 style="font-size:20px;font-weight:600;color:#0f172a;margin:0 0 4px;letter-spacing:-0.3px">Just checking in on your quote</h1>
      <p style="font-size:13px;color:#475569;margin:14px 0 0;line-height:1.6">${greeting}</p>
      <p style="font-size:13px;color:#475569;margin:10px 0 0;line-height:1.6">
        We sent through your quote ${input.daysSinceSent} day${input.daysSinceSent === 1 ? "" : "s"} ago${input.siteName ? ` for <strong>${input.siteName}</strong>` : ""} and wanted to make sure it landed in your inbox.
      </p>
      <p style="font-size:13px;color:#475569;margin:10px 0 0;line-height:1.6">
        If you have any questions or need a small tweak, reply to this email — happy to help. Otherwise, you can review and accept it online below.
      </p>
    </td></tr>

    <tr><td align="center" style="padding:28px 32px 8px;text-align:center">
      <a href="${input.respondUrl}" style="display:inline-block;background:#3b82f6;color:#ffffff;text-align:center;padding:14px 28px;border-radius:10px;font-size:14px;font-weight:700;text-decoration:none;letter-spacing:0.3px">
        View &amp; Respond
      </a>
      <p style="font-size:11px;color:#94a3b8;margin:14px 0 0;text-align:center;line-height:1.5">
        Quote ${input.quoteRef} — accept, decline, or reply with questions.
      </p>
    </td></tr>

    ${emailFooter("Reply to this email if you have any questions.")}
  `);

const resend = new Resend(RESEND_KEY);
const result = await resend.emails.send({
  from: "Centrefit Sales <sales@centrefit.com.au>",
  replyTo: "sales@centrefit.com.au",
  to: input.to,
  subject: `[PREVIEW] Following up on Quote ${input.quoteRef} — ${input.customerName}`,
  html,
  headers: {
    "X-Cf-Doc-Type": "quote",
    "X-Cf-Doc-Id": input.quoteId,
    "X-Cf-Email-Type": "quote-followup-preview",
  },
});

if (result.error) {
  console.error("FAILED:", result.error);
  process.exit(1);
}
console.log(`Preview sent to ${TO} (id: ${result.data?.id})`);
