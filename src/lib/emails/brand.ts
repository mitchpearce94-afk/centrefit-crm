/**
 * Shared email branding for every email the CRM sends.
 *
 * One header (dark gradient strip + white logo on the left, optional context
 * label/value on the right) and one footer (ABN + address). Every customer or
 * staff-facing email body wraps these so the visual identity stays consistent
 * across quotes, invites, password resets and supplier RFQs.
 */

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://crm.centrefit.com.au";

export function emailHeader(opts?: { rightLabel?: string; rightValue?: string }): string {
  const rightTable = opts?.rightLabel
    ? `
      <table align="right" border="0" cellpadding="0" cellspacing="0" role="presentation" style="float:right">
        <tr><td align="right" style="text-align:right;white-space:nowrap;padding-top:6px">
          <p style="font-size:10px;color:#94a3b8;margin:0;letter-spacing:1.5px;text-transform:uppercase;font-weight:700">${opts.rightLabel}</p>
          ${opts.rightValue ? `<p style="font-size:16px;font-weight:700;color:#60a5fa;margin:3px 0 0;font-family:'Consolas','SF Mono',monospace">${opts.rightValue}</p>` : ""}
        </td></tr>
      </table>`
    : "";
  // Gmail mobile ignores width="50%" on table cells when the parent has
  // narrow content. Bulletproof workaround: two SEPARATE tables — one with
  // align="left" (logo) and one with align="right" (label/value). Old-school
  // float-via-align-attribute is honoured everywhere, including Gmail iOS &
  // Android, where width-based 50/50 splits are flaky.
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

export function emailFooter(extra?: string): string {
  return `
    <tr><td style="background:#f8fafc;border-top:1px solid #e2e8f0;padding:18px 32px;text-align:center">
      <p style="font-size:11px;color:#475569;margin:0;font-weight:600">Centrefit Group Pty Ltd</p>
      <p style="font-size:10px;color:#94a3b8;margin:3px 0 0">ABN 55 168 413 161 · 1/25 Paisley Drive, Lawnton QLD 4501 · (07) 3188 5115</p>
      ${extra ? `<p style="font-size:10px;color:#94a3b8;margin:6px 0 0">${extra}</p>` : ""}
    </td></tr>`;
}

export function emailLayout(content: string): string {
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
