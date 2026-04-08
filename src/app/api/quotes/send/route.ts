import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { Resend } from "resend";
import { generateScopeOfWorks } from "@/lib/quote-engine";
import { autoTransitionJobStatusServer } from "@/lib/job-status-transitions";
import crypto from "crypto";

function getResend() {
  return new Resend(process.env.RESEND_API_KEY);
}

function fmt(n: number): string {
  return n.toLocaleString("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export async function POST(req: NextRequest) {
  const { quoteId, email } = await req.json();
  if (!quoteId || !email) {
    return NextResponse.json({ error: "Missing quoteId or email" }, { status: 400 });
  }

  const supabase = await createClient();

  // Fetch quote
  const { data: quote, error } = await supabase
    .from("quotes")
    .select("*, customer:customers(id, name)")
    .eq("id", quoteId)
    .single();

  if (error || !quote) {
    return NextResponse.json({ error: "Quote not found" }, { status: 404 });
  }

  const pricing = quote.pricing_snapshot;
  if (!pricing) {
    return NextResponse.json({ error: "Quote has no pricing" }, { status: 400 });
  }

  // Generate a response token
  const responseToken = crypto.randomBytes(32).toString("hex");

  // Save the token and email
  await supabase.from("quotes").update({
    status: "sent",
    sent_at: new Date().toISOString(),
    sent_to_email: email,
    response_token: responseToken,
  }).eq("id", quoteId);

  // Auto-transition linked job to "Quote Sent"
  if (quote.job_id) {
    await autoTransitionJobStatusServer(quote.job_id, "quote_sent", supabase);
  }

  const clientName = quote.customer?.name || quote.client_name;
  const isProgress = quote.quote_type === "progress";
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "https://crm.centrefitgroup.com.au";
  const respondUrl = `${baseUrl}/quote-response/${responseToken}`;

  // Build scope of works for the email
  const deviceCounts = quote.device_counts || {};
  const siteInfo = {
    site_sqm: quote.site_sqm ?? 0,
    door_count: quote.door_count ?? 0,
    external_camera_count: quote.external_camera_count ?? 0,
    concrete_mount_black: quote.concrete_mount_black ?? 0,
    concrete_mount_white: quote.concrete_mount_white ?? 0,
    cardio_count: quote.cardio_count ?? 0,
    tv_count: quote.tv_count ?? 0,
    ceiling_tv_count: quote.ceiling_tv_count ?? 0,
    wall_tv_mount_count: quote.wall_tv_mount_count ?? 0,
    ceiling_tv_mount_count: quote.ceiling_tv_mount_count ?? 0,
    separate_studio_zone: quote.separate_studio_zone ?? false,
  };
  const scope = generateScopeOfWorks(deviceCounts, siteInfo);

  // Build scope HTML
  const scopeHtml = scope.sections.map(section => `
    <tr><td style="padding:16px 0 8px;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:#334155;border-bottom:1px solid #e2e8f0">${section.heading}</td></tr>
    ${section.items.map(item => {
      const isExclusion = item.startsWith('ANY AND ALL');
      return `<tr><td style="padding:4px 0 4px 12px;font-size:12px;color:${isExclusion ? '#dc2626' : '#475569'};font-weight:${isExclusion ? '700' : '400'};line-height:1.6;border-left:${isExclusion ? 'none' : '2px solid #e2e8f0'}">${item}</td></tr>`;
    }).join('')}
  `).join('');

  const notesHtml = scope.notes.length > 0 ? `
    <tr><td style="padding:16px 0">
      <div style="background:#fffbeb;border:1px solid #fde68a;border-radius:8px;padding:16px 20px">
        ${scope.notes.map(note => `<p style="font-size:11px;color:#92400e;margin:0 0 6px;line-height:1.5"><strong>PLEASE NOTE:</strong>&nbsp;&nbsp;${note}</p>`).join('')}
      </div>
    </td></tr>
  ` : '';

  // Payment section
  const paymentHtml = isProgress ? `
    <tr><td style="padding:16px 0">
      <table width="100%" cellpadding="0" cellspacing="0"><tr>
        <td width="48%" style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:20px;text-align:center">
          <p style="font-size:10px;text-transform:uppercase;letter-spacing:1px;color:#64748b;margin:0 0 8px">Payment 1 — Due on Acceptance</p>
          <p style="font-size:22px;font-weight:700;color:#0f172a;font-family:monospace;margin:0">$${fmt(pricing.pp1.total * 1.1)}</p>
          <p style="font-size:11px;color:#94a3b8;margin:4px 0 0">inc GST</p>
        </td>
        <td width="4%"></td>
        <td width="48%" style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:20px;text-align:center">
          <p style="font-size:10px;text-transform:uppercase;letter-spacing:1px;color:#64748b;margin:0 0 8px">Payment 2 — Due on Completion</p>
          <p style="font-size:22px;font-weight:700;color:#0f172a;font-family:monospace;margin:0">$${fmt(pricing.pp2.total * 1.1)}</p>
          <p style="font-size:11px;color:#94a3b8;margin:4px 0 0">inc GST</p>
        </td>
      </tr></table>
    </td></tr>
  ` : '';

  const emailHtml = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:'Segoe UI',system-ui,-apple-system,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;padding:32px 16px">
<tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,0.1)">

  <!-- Header -->
  <tr><td style="background:linear-gradient(135deg,#0f172a,#1e293b);padding:32px 40px;color:#ffffff">
    <table width="100%"><tr>
      <td><p style="font-size:11px;color:#94a3b8;margin:0">Centrefit Group Pty Ltd</p><p style="font-size:11px;color:#94a3b8;margin:0">ABN: 55 168 413 161</p></td>
      <td style="text-align:right"><p style="font-size:24px;font-weight:700;margin:0;letter-spacing:-0.5px">QUOTATION</p><p style="font-size:14px;color:#60a5fa;font-weight:600;margin:4px 0 0">${quote.ref}</p><p style="font-size:11px;color:#94a3b8;margin:4px 0 0">${new Date(quote.created_at).toLocaleDateString("en-AU", { day: "numeric", month: "long", year: "numeric" })}</p></td>
    </tr></table>
  </td></tr>

  <!-- Client bar -->
  <tr><td style="background:#f8fafc;border-bottom:1px solid #e2e8f0;padding:16px 40px">
    <p style="font-size:10px;text-transform:uppercase;letter-spacing:1px;color:#64748b;margin:0 0 4px">Prepared For</p>
    <p style="font-size:16px;font-weight:700;margin:0;color:#0f172a">${clientName}</p>
    ${quote.site_name ? `<p style="font-size:13px;color:#475569;margin:2px 0 0">${quote.site_name}</p>` : ''}
    ${quote.site_address ? `<p style="font-size:11px;color:#94a3b8;margin:2px 0 0">${quote.site_address}</p>` : ''}
  </td></tr>

  <!-- Content -->
  <tr><td style="padding:32px 40px">

    <!-- Scope of Works -->
    <table width="100%" cellpadding="0" cellspacing="0">
      <tr><td style="font-size:13px;text-transform:uppercase;letter-spacing:1.5px;color:#0f172a;font-weight:700;padding:0 0 16px;border-bottom:2px solid #0f172a">Scope of Works</td></tr>
      ${scopeHtml}
      ${notesHtml}
    </table>

    <!-- Pricing -->
    <table width="100%" cellpadding="0" cellspacing="0" style="margin-top:32px">
      <tr><td style="font-size:12px;text-transform:uppercase;letter-spacing:1.5px;color:#64748b;font-weight:700;padding:0 0 16px;border-bottom:2px solid #e2e8f0">Pricing</td></tr>
      <tr><td>
        <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden;margin-top:16px">
          <div style="padding:20px 24px">
            <table width="100%">
              ${pricing.discount?.percent > 0 ? `
              <tr><td style="font-size:14px;color:#94a3b8">Subtotal (ex GST)</td><td style="text-align:right;font-size:14px;color:#94a3b8;font-family:monospace;text-decoration:line-through">$${fmt(pricing.fullPriceExGST)}</td></tr>
              <tr><td style="font-size:14px;color:#16a34a;padding-top:4px">${pricing.discount.percent}% Discount</td><td style="text-align:right;font-size:14px;color:#16a34a;font-family:monospace;padding-top:4px">-$${fmt(pricing.discount.amount)}</td></tr>
              ` : ''}
              <tr><td style="font-size:14px;color:#64748b${pricing.discount?.percent > 0 ? ';padding-top:8px;border-top:1px solid #e2e8f0' : ''}">Total (ex GST)</td><td style="text-align:right;font-size:16px;font-weight:600;color:#0f172a;font-family:monospace${pricing.discount?.percent > 0 ? ';padding-top:8px;border-top:1px solid #e2e8f0' : ''}">$${fmt(pricing.totalExGST)}</td></tr>
              <tr><td style="font-size:14px;color:#64748b;padding-top:4px">GST (10%)</td><td style="text-align:right;font-size:14px;color:#475569;font-family:monospace;padding-top:4px">$${fmt(pricing.gst)}</td></tr>
            </table>
          </div>
          <div style="background:#0f172a;padding:16px 24px">
            <table width="100%"><tr>
              <td style="font-size:14px;font-weight:700;color:#ffffff;text-transform:uppercase;letter-spacing:0.5px">Total (inc GST)</td>
              <td style="text-align:right;font-size:24px;font-weight:800;color:#ffffff;font-family:monospace">$${fmt(pricing.totalIncGST)}</td>
            </tr></table>
          </div>
        </div>
      </td></tr>
    </table>

    ${paymentHtml}

    <!-- Accept / Decline buttons -->
    <table width="100%" cellpadding="0" cellspacing="0" style="margin-top:32px">
      <tr>
        <td width="48%">
          <a href="${respondUrl}?action=accept" style="display:block;background:#16a34a;color:#ffffff;text-align:center;padding:16px;border-radius:10px;font-size:16px;font-weight:700;text-decoration:none;letter-spacing:0.5px">
            ACCEPT QUOTE
          </a>
        </td>
        <td width="4%"></td>
        <td width="48%">
          <a href="${respondUrl}?action=decline" style="display:block;background:#ffffff;color:#dc2626;text-align:center;padding:16px;border-radius:10px;font-size:16px;font-weight:700;text-decoration:none;letter-spacing:0.5px;border:2px solid #fca5a5">
            DECLINE
          </a>
        </td>
      </tr>
    </table>

    <!-- Standards -->
    <div style="margin-top:32px;padding-top:16px;border-top:1px solid #e2e8f0">
      <p style="font-size:10px;text-transform:uppercase;letter-spacing:1px;color:#94a3b8;font-weight:700;margin:0 0 8px">Standards and Codes of Practice</p>
      ${scope.standards.map(std => `<p style="font-size:10px;color:#94a3b8;margin:0 0 2px">${std}</p>`).join('')}
    </div>

    <!-- Terms -->
    <div style="margin-top:16px;font-size:10px;color:#94a3b8;line-height:1.6">
      <p style="margin:0 0 3px">This quotation is valid for 30 days from the date of issue.</p>
      <p style="margin:0 0 3px">Any and all electrical works are not included in this quotation.</p>
    </div>

  </td></tr>

  <!-- Footer -->
  <tr><td style="background:#f8fafc;border-top:1px solid #e2e8f0;padding:16px 40px;text-align:center">
    <p style="font-size:10px;color:#94a3b8;margin:0">Centrefit Group Pty Ltd · ABN 55 168 413 161</p>
    <p style="font-size:10px;color:#94a3b8;margin:2px 0 0">1/25 Paisley Drive, Lawnton QLD 4501 · (07) 3188 5115</p>
  </td></tr>

</table>
</td></tr>
</table>
</body>
</html>`;

  try {
    const { error: sendError } = await getResend().emails.send({
      from: "CentreFit <quotes@centrefitgroup.com.au>",
      to: email,
      subject: `Quotation ${quote.ref} — ${clientName}${quote.site_name ? ` — ${quote.site_name}` : ''}`,
      html: emailHtml,
    });

    if (sendError) {
      return NextResponse.json({ error: sendError.message }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
