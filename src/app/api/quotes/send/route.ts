import { NextRequest, NextResponse } from "next/server";
import { withLiveSite } from "@/lib/quotes/live-site";
import { createClient } from "@/lib/supabase/server";
import { Resend } from "resend";
import { generateScopeOfWorks, manualScopeDocument, renderScopeAsText, type ScopeDocument } from "@/lib/quote-engine";
import { generateQuotePdfBuffer, type QuoteForPdf } from "@/lib/quote-pdf";
import { generateProposalPdfBuffer } from "@/lib/proposal-pdf";
import { autoTransitionJobStatusServer } from "@/lib/job-status-transitions.server";
import { emailHeader, emailFooter, emailLayout } from "@/lib/emails/brand";
import { FROM_QUOTES, REPLY_TO_SALES } from "@/lib/emails/from-addresses";
import { logDocumentActivity } from "@/lib/activity/log";
import { newResponseToken } from "@/lib/quotes/tender";
import crypto from "crypto";

function formatAud(n: number): string {
  return n.toLocaleString("en-AU", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function buildJobScopeText(
  scope: ScopeDocument,
  pricing: { totalExGST: number; pp1?: { total: number }; pp2?: { total: number } },
  isProgress: boolean,
): string {
  const scopeText = renderScopeAsText(scope);
  const paymentLines: string[] = ["PAYMENT TERMS"];
  if (isProgress && pricing.pp1 && pricing.pp2) {
    paymentLines.push(`  • Progress Payment 1 (PP1) — On acceptance: $${formatAud(pricing.pp1.total)} ex GST`);
    paymentLines.push(`  • Progress Payment 2 (PP2) — On completion: $${formatAud(pricing.pp2.total)} ex GST`);
  } else {
    paymentLines.push(`  • Full payment on completion: $${formatAud(pricing.totalExGST)} ex GST`);
  }
  return `${scopeText}\n\n${paymentLines.join("\n")}`;
}

function getResend() {
  return new Resend(process.env.RESEND_API_KEY);
}


export async function POST(req: NextRequest) {
  const { quoteId, email, proposal, builderIds } = await req.json();
  // Two shapes (docs/job-lifecycle-CONTEXT.md D10): `email` sends the
  // owner/customer link; `builderIds` (site_builders ids) sends one link per
  // builder tendering, each addressed to that builder.
  const toBuilders: string[] = Array.isArray(builderIds) ? builderIds.map(String).filter(Boolean) : [];
  if (!quoteId || (!email && toBuilders.length === 0)) {
    return NextResponse.json({ error: "Missing quoteId or recipients" }, { status: 400 });
  }
  const asProposal = proposal === true;

  const supabase = await createClient();

  const { data: quote, error } = await supabase
    .from("quotes")
    .select("*, customer:customers(id, name, customer_contacts(name, email, is_primary))")
    .eq("id", quoteId)
    .single();

  if (error || !quote) {
    return NextResponse.json({ error: "Quote not found" }, { status: 404 });
  }
  // Last refresh of the site name/address from the site record before the
  // copy on the quote is frozen for the customer.
  {
    const live = await withLiveSite(supabase, quote, { force: quote.status === "draft" });
    quote.site_name = live.site_name;
    quote.site_address = live.site_address;
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

  // Quoting v2 D5: the completeness check blocks send unless every error was
  // overridden with a reason in the wizard (kept on the quote for the audit).
  const lintFindings = (quote.lint_findings ?? []) as { code: string; severity: string; message: string }[];
  const lintOverrides = (quote.lint_overrides ?? {}) as Record<string, string>;
  const blocking = lintFindings.filter((f) => f.severity === "error" && !(lintOverrides[`${f.code}|${f.message}`] ?? "").trim());
  if (blocking.length) {
    return NextResponse.json({ error: `Quote check failed — fix or override in the wizard: ${blocking.map((b) => b.message).join(" · ")}` }, { status: 409 });
  }

  // ── Who gets a link ──
  // Each recipient has its own token: the quote's response_token for the
  // owner/customer; a quote_builders row per builder. Re-sends reuse tokens
  // so any email already in an inbox still works.
  type Recipient = { kind: "owner" | "builder"; name: string; email: string; token: string; greetingName: string | null; quoteBuilderId?: string };
  const recipients: Recipient[] = [];
  const svcForTender = (await import("@/lib/supabase/service")).createServiceRoleClient();

  if (toBuilders.length > 0) {
    if (!quote.site_id) {
      return NextResponse.json({ error: "Link a site to the quote before sending to builders" }, { status: 400 });
    }
    const { data: builderRows } = await svcForTender
      .from("site_builders")
      .select("id, name, email, contact_name")
      .eq("site_id", quote.site_id)
      .in("id", toBuilders);
    const missingEmail = (builderRows ?? []).filter((b) => !b.email?.trim());
    if (missingEmail.length) {
      return NextResponse.json({ error: `No email on file for ${missingEmail.map((b) => b.name).join(", ")} — add it on the site's Builder tab` }, { status: 400 });
    }
    if ((builderRows ?? []).length !== toBuilders.length) {
      return NextResponse.json({ error: "One of those builders isn't on this quote's site" }, { status: 400 });
    }
    for (const b of builderRows ?? []) {
      const { data: existing } = await svcForTender
        .from("quote_builders")
        .select("id, response_token, status")
        .eq("quote_id", quoteId)
        .eq("site_builder_id", b.id)
        .maybeSingle();
      if (existing?.status === "accepted" || existing?.status === "declined" || existing?.status === "lost") continue;
      const token = existing?.response_token ?? newResponseToken();
      const { data: row } = await svcForTender
        .from("quote_builders")
        .upsert(
          { quote_id: quoteId, site_builder_id: b.id, response_token: token, status: "sent", sent_at: new Date().toISOString(), sent_to_email: b.email },
          { onConflict: "quote_id,site_builder_id" },
        )
        .select("id")
        .single();
      recipients.push({ kind: "builder", name: b.name, email: b.email as string, token, greetingName: b.contact_name?.trim().split(/\s+/)[0] ?? null, quoteBuilderId: row?.id });
    }
    if (recipients.length === 0) {
      return NextResponse.json({ error: "Every builder on this tender has already responded" }, { status: 409 });
    }
  }

  const ownerToken: string | null = email
    ? ((quote.response_token as string | null) ?? crypto.randomBytes(32).toString("hex"))
    : (quote.response_token as string | null);
  if (email) {
    const contacts = quote.customer?.customer_contacts ?? [];
    const matchedContact =
      contacts.find((c: { email?: string | null; is_primary?: boolean }) => c.email && email && c.email.toLowerCase() === email.toLowerCase()) ??
      contacts.find((c: { is_primary?: boolean }) => c.is_primary) ??
      contacts[0] ??
      null;
    recipients.push({
      kind: "owner",
      name: quote.customer?.name || quote.client_name,
      email,
      token: ownerToken as string,
      greetingName: matchedContact?.name?.trim().split(/\s+/)[0] ?? null,
    });
  }

  await supabase.from("quotes").update({
    status: "sent",
    site_name: quote.site_name,
    site_address: quote.site_address,
    sent_at: new Date().toISOString(),
    sent_to_email: recipients.map((r) => r.email).join(", "),
    response_token: ownerToken,
    // Remembered so the by-token PDF endpoint serves the same document the
    // customer received in the email.
    sent_as_proposal: asProposal,
    ...(toBuilders.length > 0 ? { bill_to_party: "builder" } : {}),
  }).eq("id", quoteId);

  const isProgress = quote.quote_type === "progress";
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || `${req.nextUrl.origin}`;
  // Proposals lead with the interactive web proposal (PDF attached as the
  // printable fallback); plain quotes keep the classic response page.
  const respondUrlFor = (token: string) => asProposal
    ? `${baseUrl}/proposal/${token}`
    : `${baseUrl}/quote-response/${token}`;

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
  // Manual quotes use the operator-authored scope text verbatim. The PDF +
  // job description mirror keep the same plain text the customer sees on
  // the response page.
  const manualScopeText =
    quote.quote_mode === "manual"
      ? (quote.labour_data?.scope_of_works ?? "").trim()
      : "";
  const scope: ScopeDocument = manualScopeText
    ? manualScopeDocument(manualScopeText, quote.labour_data?.ongoing_costs)
    : generateScopeOfWorks(scopeBom, scopeProducts, siteInfo, quote.scope_overrides ?? undefined, roleDescriptions, (quote.device_counts as Record<string, number> | null) ?? undefined);

  // Mirror the scope-of-works + payment terms into the linked job's description.
  // Quote is the source of truth for scope, so we overwrite on every send —
  // subsequent re-sends keep the job description aligned with the latest quote.
  if (quote.job_id) {
    const jobScopeText = buildJobScopeText(scope, pricing as { totalExGST: number; pp1?: { total: number }; pp2?: { total: number } }, isProgress);
    await supabase.from("jobs").update({ description: jobScopeText }).eq("id", quote.job_id);
    await autoTransitionJobStatusServer(quote.job_id, "quote_sent", supabase);
  }

  // Generate the PDF per recipient — a builder's copy is addressed to the
  // builder, the owner's to the customer.
  async function pdfFor(name: string): Promise<Buffer> {
    const quoteForPdf: QuoteForPdf = {
      ref: quote.ref,
      createdAt: quote.created_at,
      clientName: name,
      siteName: quote.site_name,
      siteAddress: quote.site_address,
      isProgress,
      pricing: pricing as NonNullable<typeof pricing>,
    };
    return asProposal
      ? await generateProposalPdfBuffer(quoteForPdf, scope)
      : await generateQuotePdfBuffer(quoteForPdf, scope);
  }

  // ── Build summary email body ─────────────────────────────────────────────
  // The body is intentionally short. The full quote — totals, scope of works,
  // by-others, standards, etc — lives in the attached PDF AND on the
  // quote-response page they click through to.

  const subtitleParts = [quote.site_name, quote.site_address].filter(Boolean);

  const docLabel = asProposal ? "Proposal" : "Quotation";
  const attachmentBlurb = asProposal
    ? "Your project proposal is best experienced online via the button below — who we are, how we support you, and your detailed quotation with the full scope of works and pricing, ready to review and accept in one place. A PDF copy is attached for your records."
    : "Your detailed quotation is attached as a PDF and is also available online via the link below — including the full scope of works, pricing breakdown, ongoing costs and applicable standards.";
  const reviewLine = asProposal
    ? "Click below to view your proposal — or reply to this email with any questions."
    : "Please review the attached PDF, then click below to view it online and accept or decline.";
  const buttonLabel = asProposal ? "View Your Proposal" : "View Quote &amp; Respond Online";

  const emailHtmlFor = (greeting: string, respondUrl: string) => emailLayout(`
  ${emailHeader({ rightLabel: docLabel, rightValue: quote.ref })}

  <!-- Body -->
  <tr><td style="padding:32px 32px 12px">
    <h1 style="font-size:20px;font-weight:600;color:#0f172a;margin:0 0 4px;letter-spacing:-0.3px">Your Centrefit ${asProposal ? "proposal" : "quote"} is ready</h1>
    <p style="font-size:13px;color:#475569;margin:14px 0 0;line-height:1.6">${greeting}</p>
    <p style="font-size:13px;color:#475569;margin:10px 0 0;line-height:1.6">
      Thanks for the opportunity to quote ${quote.site_name ? `<strong>${quote.site_name}</strong>` : "your project"}. ${attachmentBlurb}
    </p>
    <p style="font-size:13px;color:#475569;margin:10px 0 0;line-height:1.6">
      ${reviewLine}
    </p>
  </td></tr>

  ${subtitleParts.length > 0 ? `
  <tr><td style="padding:0 32px 8px">
    <p style="font-size:11px;color:#94a3b8;margin:0;line-height:1.5">${subtitleParts.join(' · ')}</p>
  </td></tr>` : ''}

  <!-- View / respond button — centred via td align="center" + inline-block link -->
  <tr><td align="center" style="padding:28px 32px 8px;text-align:center">
    <a href="${respondUrl}" style="display:inline-block;background:#3b82f6;color:#ffffff;text-align:center;padding:14px 28px;border-radius:10px;font-size:14px;font-weight:700;text-decoration:none;letter-spacing:0.3px;mso-padding-alt:0">
      ${buttonLabel}
    </a>
    <p style="font-size:11px;color:#94a3b8;margin:14px 0 0;text-align:center;line-height:1.5">
      You can review the full quote and accept or decline at the link above. Valid for 30 days.
    </p>
  </td></tr>

  ${emailFooter("Reply to this email if you have any questions.")}
`);

  try {
    const filename = asProposal ? `Centrefit-Proposal-${quote.ref}.pdf` : `Centrefit-Quote-${quote.ref}.pdf`;
    const sentTo: string[] = [];
    for (const r of recipients) {
      // Accept comma-separated email lists from the UI — Sue asked for multi-
      // recipient billing for sites that have a separate AP / GM email split.
      const toList = r.email.split(",").map((x) => x.trim()).filter((x) => x.length > 0);
      if (toList.length === 0) continue;
      let pdfBuffer: Buffer;
      try {
        pdfBuffer = await pdfFor(r.name);
      } catch (err) {
        return NextResponse.json(
          { error: `Failed to generate PDF: ${err instanceof Error ? err.message : String(err)}` },
          { status: 500 },
        );
      }
      const greeting = r.greetingName ? `Hi ${r.greetingName},` : "Hi,";
      const { error: sendError } = await getResend().emails.send({
        from: FROM_QUOTES,
        replyTo: REPLY_TO_SALES,
        to: toList,
        subject: `${docLabel} ${quote.ref} — ${r.name}${quote.site_name ? ` — ${quote.site_name}` : ''}`,
        html: emailHtmlFor(greeting, respondUrlFor(r.token)),
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
        return NextResponse.json({ error: `${r.name}: ${sendError.message}` }, { status: 500 });
      }
      sentTo.push(r.email);
      await logDocumentActivity({
        supabase,
        documentType: "quote",
        documentId: quote.id,
        eventType: "quote.sent",
        metadata: { to: r.email, ref: quote.ref, ...(r.kind === "builder" ? { builder: r.name } : {}) },
      });
    }

    return NextResponse.json({ success: true, sentTo });
  } catch (err: unknown) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
