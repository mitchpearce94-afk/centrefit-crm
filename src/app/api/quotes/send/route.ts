import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { Resend } from "resend";
import { generateScopeOfWorks } from "@/lib/quote-engine";
import { generateQuotePdfBuffer, type QuoteForPdf } from "@/lib/quote-pdf";
import { autoTransitionJobStatusServer } from "@/lib/job-status-transitions.server";
import { emailHeader, emailFooter, emailLayout } from "@/lib/emails/brand";
import { logDocumentActivity } from "@/lib/activity/log";
import crypto from "crypto";

function getResend() {
  return new Resend(process.env.RESEND_API_KEY);
}


export async function POST(req: NextRequest) {
  const { quoteId, email } = await req.json();
  if (!quoteId || !email) {
    return NextResponse.json({ error: "Missing quoteId or email" }, { status: 400 });
  }

  const supabase = await createClient();

  const { data: quote, error } = await supabase
    .from("quotes")
    .select("*, customer:customers(id, name, customer_contacts(name, email, is_primary))")
    .eq("id", quoteId)
    .single();

  if (error || !quote) {
    return NextResponse.json({ error: "Quote not found" }, { status: 404 });
  }

  const pricing = quote.pricing_snapshot as {
    totalExGST: number;
    totalIncGST: number;
    gst: number;
    fullPriceExGST?: number;
    discount?: { percent: number; amount: number };
    pp1?: { total: number };
    pp2?: { total: number };
  } | null;
  if (!pricing) {
    return NextResponse.json({ error: "Quote has no pricing" }, { status: 400 });
  }

  // Reuse the existing response_token if the quote has one — re-sends keep
  // the same link so any email already in a recipient's inbox still works.
  // Only mint a fresh token on the very first send.
  const responseToken: string =
    (quote.response_token as string | null) ?? crypto.randomBytes(32).toString("hex");
  await supabase.from("quotes").update({
    status: "sent",
    sent_at: new Date().toISOString(),
    sent_to_email: email,
    response_token: responseToken,
  }).eq("id", quoteId);

  if (quote.job_id) {
    await autoTransitionJobStatusServer(quote.job_id, "quote_sent", supabase);
  }

  const clientName = quote.customer?.name || quote.client_name;
  const isProgress = quote.quote_type === "progress";
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || `${req.nextUrl.origin}`;
  const respondUrl = `${baseUrl}/quote-response/${responseToken}`;

  // Build the full scope so we can attach a PDF mirroring what the customer
  // would see in the in-CRM preview.
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
  const [{ data: scopeBomRows }, { data: scopeProductRows }, { data: scopeRoleRows }] = await Promise.all([
    supabase.from("quote_line_items").select("product_id, quantity").eq("quote_id", quoteId),
    supabase.from("quote_products").select("id, scope_role, name, sku"),
    supabase.from("quote_scope_roles").select("slug, description"),
  ]);
  const scopeBom = (scopeBomRows ?? []).map((r: { product_id: string | null; quantity: number }) => ({
    product_id: r.product_id ?? null,
    quantity: Number(r.quantity) || 0,
  }));
  const scopeProducts = (scopeProductRows ?? []) as Array<{ id: string; scope_role: string }>;
  const roleDescriptions: Record<string, string> = {};
  for (const r of scopeRoleRows ?? []) {
    if (r.description && r.description.trim().length > 0) roleDescriptions[r.slug] = r.description.trim();
  }
  const scope = generateScopeOfWorks(scopeBom, scopeProducts, siteInfo, quote.scope_overrides ?? undefined, roleDescriptions);

  // Generate PDF attachment
  let pdfBuffer: Buffer;
  try {
    const quoteForPdf: QuoteForPdf = {
      ref: quote.ref,
      createdAt: quote.created_at,
      clientName,
      siteName: quote.site_name,
      siteAddress: quote.site_address,
      isProgress,
      pricing,
    };
    pdfBuffer = await generateQuotePdfBuffer(quoteForPdf, scope);
  } catch (err) {
    return NextResponse.json(
      { error: `Failed to generate PDF: ${err instanceof Error ? err.message : String(err)}` },
      { status: 500 },
    );
  }

  // ── Build summary email body ─────────────────────────────────────────────
  // The body is intentionally short. The full quote — totals, scope of works,
  // by-others, standards, etc — lives in the attached PDF AND on the
  // quote-response page they click through to.

  const contacts = quote.customer?.customer_contacts ?? [];
  const matchedContact =
    contacts.find((c: { email?: string | null; is_primary?: boolean }) => c.email && email && c.email.toLowerCase() === email.toLowerCase()) ??
    contacts.find((c: { is_primary?: boolean }) => c.is_primary) ??
    contacts[0] ??
    null;
  const contactFirstName = matchedContact?.name?.trim().split(/\s+/)[0] ?? null;
  const greeting = contactFirstName ? `Hi ${contactFirstName},` : "Hi,";

  const subtitleParts = [quote.site_name, quote.site_address].filter(Boolean);

  const emailHtml = emailLayout(`
  ${emailHeader({ rightLabel: "Quotation", rightValue: quote.ref })}

  <!-- Body -->
  <tr><td style="padding:32px 32px 12px">
    <h1 style="font-size:20px;font-weight:600;color:#0f172a;margin:0 0 4px;letter-spacing:-0.3px">Your Centrefit quote is ready</h1>
    <p style="font-size:13px;color:#475569;margin:14px 0 0;line-height:1.6">${greeting}</p>
    <p style="font-size:13px;color:#475569;margin:10px 0 0;line-height:1.6">
      Thanks for the opportunity to quote ${quote.site_name ? `<strong>${quote.site_name}</strong>` : "your project"}. Your detailed quotation is attached as a PDF and is also available online via the link below — including the full scope of works, pricing breakdown, ongoing costs and applicable standards.
    </p>
    <p style="font-size:13px;color:#475569;margin:10px 0 0;line-height:1.6">
      Please review the attached PDF, then click below to view it online and accept or decline.
    </p>
  </td></tr>

  ${subtitleParts.length > 0 ? `
  <tr><td style="padding:0 32px 8px">
    <p style="font-size:11px;color:#94a3b8;margin:0;line-height:1.5">${subtitleParts.join(' · ')}</p>
  </td></tr>` : ''}

  <!-- View / respond button — centred via td align="center" + inline-block link -->
  <tr><td align="center" style="padding:28px 32px 8px;text-align:center">
    <a href="${respondUrl}" style="display:inline-block;background:#3b82f6;color:#ffffff;text-align:center;padding:14px 28px;border-radius:10px;font-size:14px;font-weight:700;text-decoration:none;letter-spacing:0.3px;mso-padding-alt:0">
      View Quote &amp; Respond Online
    </a>
    <p style="font-size:11px;color:#94a3b8;margin:14px 0 0;text-align:center;line-height:1.5">
      You can review the full quote and accept or decline at the link above. Valid for 30 days.
    </p>
  </td></tr>

  ${emailFooter("Reply to this email if you have any questions.")}
`);

  try {
    const filename = `Centrefit-Quote-${quote.ref}.pdf`;
    const { error: sendError } = await getResend().emails.send({
      from: "Centrefit Quotes <quotes@centrefit.com.au>",
      to: email,
      subject: `Quotation ${quote.ref} — ${clientName}${quote.site_name ? ` — ${quote.site_name}` : ''}`,
      html: emailHtml,
      // Custom headers — picked up by /api/resend/webhook to link
      // delivered / opened / bounced events to this quote on the activity
      // timeline (workstream E).
      headers: {
        "X-Cf-Doc-Type": "quote",
        "X-Cf-Doc-Id": quote.id,
      },
      attachments: [
        {
          filename,
          content: pdfBuffer.toString("base64"),
        },
      ],
    });

    if (sendError) {
      return NextResponse.json({ error: sendError.message }, { status: 500 });
    }

    await logDocumentActivity({
      supabase,
      documentType: "quote",
      documentId: quote.id,
      eventType: "quote.sent",
      metadata: { to: email, ref: quote.ref },
    });

    return NextResponse.json({ success: true });
  } catch (err: unknown) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
