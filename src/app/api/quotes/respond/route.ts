import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { autoTransitionJobStatusServer } from "@/lib/job-status-transitions.server";
import { createInvoiceFromAcceptedQuote } from "@/lib/invoices/create-from-quote";
import { logDocumentActivity } from "@/lib/activity/log";
import { enqueueNotification } from "@/lib/notifications/enqueue";
import { notifyProcurementReadyIfEligible } from "@/lib/notifications/procurement-ready";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { syncQuoteScopeToJob } from "@/lib/quotes/sync-job-scope";
import { resolveQuoteToken } from "@/lib/quotes/tender";

export async function POST(req: NextRequest) {
  const { token, action } = await req.json();
  if (!token || !["accept", "decline"].includes(action)) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const cookieStore = await cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll: () => cookieStore.getAll() } }
  );

  // Atomic transition: only flip status if it's still 'sent'. This protects
  // against races where email spam scanners fetch both accept AND decline
  // links within milliseconds of each other — without the WHERE clause we
  // had a time-of-check/time-of-use gap that let the second write clobber
  // the first (happened 2026-04-22 with CF-2026-0006: accept at 11:41:05.399
  // then decline at 11:41:05.452).
  const newStatus = action === "accept" ? "accepted" : "declined";
  const nowIso = new Date().toISOString();
  const QUOTE_SELECT = "id, ref, status, job_id, created_by, site_name, pricing_snapshot, accepted_builder_id, customer:customers(name), job:jobs(number)";

  // Whose link is this — the owner's, or one builder's on a tender
  // (docs/job-lifecycle-CONTEXT.md D10/D11)?
  const resolved = await resolveQuoteToken<{ id: string; ref: string; status: string; accepted_builder_id: string | null }>(
    supabase, token, "id, ref, status, accepted_builder_id",
  );
  if (!resolved) {
    return NextResponse.json({ error: "Quote not found or link expired" }, { status: 404 });
  }
  if (resolved.effectiveStatus !== "sent") {
    return NextResponse.json(
      { error: resolved.effectiveStatus === "lost" ? "This quote has been awarded to another builder" : `Quote has already been ${resolved.effectiveStatus}` },
      { status: 400 },
    );
  }
  const builder = resolved.builder;

  let updated: Record<string, unknown> | null = null;
  if (builder) {
    // Builder link. Their own row first (atomic on status = sent), then —
    // on accept — the quote itself, atomic on status = sent so two builders
    // accepting within milliseconds can't both win.
    const { data: qbRow } = await supabase
      .from("quote_builders")
      .update({ status: newStatus, responded_at: nowIso })
      .eq("id", builder.id)
      .eq("status", "sent")
      .select("id")
      .maybeSingle();
    if (!qbRow) {
      return NextResponse.json({ error: "This link has already been used" }, { status: 400 });
    }
    if (action === "accept") {
      const { data: q, error: updateError } = await supabase
        .from("quotes")
        .update({ status: "accepted", accepted_at: nowIso, accepted_builder_id: builder.siteBuilderId, bill_to_party: "builder" })
        .eq("id", resolved.quote.id)
        .eq("status", "sent")
        .select(QUOTE_SELECT)
        .maybeSingle();
      if (updateError) return NextResponse.json({ error: updateError.message }, { status: 500 });
      if (!q) {
        // Lost the race — another builder accepted first. Put the row back.
        await supabase.from("quote_builders").update({ status: "lost", responded_at: nowIso }).eq("id", builder.id);
        return NextResponse.json({ error: "This quote has just been awarded to another builder" }, { status: 400 });
      }
      await supabase.from("quote_builders").update({ status: "lost" }).eq("quote_id", q.id).neq("id", builder.id).in("status", ["pending", "sent"]);
      updated = q;
    } else {
      // One builder declining only closes their own link. The quote is
      // declined once nobody is left to answer.
      const { count: stillOpen } = await supabase
        .from("quote_builders")
        .select("id", { count: "exact", head: true })
        .eq("quote_id", resolved.quote.id)
        .in("status", ["pending", "sent"]);
      const { data: qTok } = await supabase.from("quotes").select("response_token").eq("id", resolved.quote.id).maybeSingle();
      const ownerStillOpen = !!qTok?.response_token;
      if ((stillOpen ?? 0) === 0 && !ownerStillOpen) {
        const { data: q } = await supabase
          .from("quotes")
          .update({ status: "declined", declined_at: nowIso })
          .eq("id", resolved.quote.id)
          .eq("status", "sent")
          .select(QUOTE_SELECT)
          .maybeSingle();
        updated = q ?? null;
      }
      if (!updated) {
        // Quote stays open for the others — tell the builder and the team,
        // then stop here (no job transition, no invoice).
        await logDocumentActivity({
          supabase,
          documentType: "quote",
          documentId: resolved.quote.id,
          eventType: "quote.declined",
          actor: "recipient",
          metadata: { builder: builder.name, partial: true },
        });
        await enqueueNotification({
          supabase,
          typeCode: "quote.declined",
          refType: "quote",
          refId: resolved.quote.id,
          audience: { allActive: true },
          title: `${builder.name} declined ${resolved.quote.ref}`,
          body: `Other builders on the tender can still accept.`,
          href: `/quoting/${resolved.quote.id}`,
        });
        return NextResponse.json({ success: true, action, ref: resolved.quote.ref, partial: true });
      }
    }
  } else {
    const { data: q, error: updateError } = await supabase
      .from("quotes")
      .update({ status: newStatus, [`${newStatus}_at`]: nowIso })
      .eq("response_token", token)
      .eq("status", "sent")
      .select(QUOTE_SELECT)
      .maybeSingle();
    if (updateError) return NextResponse.json({ error: updateError.message }, { status: 500 });
    if (!q) return NextResponse.json({ error: "Quote has already been responded to" }, { status: 400 });
    if (action === "accept") {
      // Owner accepted a tendered quote — the builders' links close.
      await supabase.from("quote_builders").update({ status: "lost" }).eq("quote_id", q.id).in("status", ["pending", "sent"]);
    }
    updated = q;
  }

  const quote = updated as {
    id: string; ref: string; job_id: string | null; created_by?: string; site_name?: string | null;
    pricing_snapshot?: { totalExGST?: number } | null;
    customer?: { name?: string } | { name?: string }[] | null;
    job?: { number?: string | null } | { number?: string | null }[] | null;
  };

  // Log the customer-driven action on the quote timeline.
  await logDocumentActivity({
    supabase,
    documentType: "quote",
    documentId: quote.id,
    eventType: `quote.${newStatus}`,
    actor: "recipient",
    metadata: {
      ip: req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
      user_agent: req.headers.get("user-agent") ?? null,
      ...(builder ? { builder: builder.name } : {}),
    },
  });

  // Notify the quote owner (workstream F). On a tender the responder is the
  // builder, not the site owner.
  const customerName = builder?.name ?? ((Array.isArray((quote as { customer?: { name?: string }[] }).customer)
    ? (quote as { customer?: { name?: string }[] }).customer?.[0]?.name
    : (quote as { customer?: { name?: string } }).customer?.name) ?? "Customer");
  const q = quote as {
    site_name?: string | null;
    pricing_snapshot?: { totalExGST?: number } | null;
    job?: { number?: string | null } | { number?: string | null }[] | null;
  };
  const linkedJobNumber = (Array.isArray(q.job) ? q.job[0]?.number : q.job?.number) ?? null;
  const quoteTotal = Number(q.pricing_snapshot?.totalExGST ?? 0);
  await enqueueNotification({
    supabase,
    typeCode: `quote.${newStatus}`,
    refType: "quote",
    refId: quote.id,
    audience: { staffId: (quote as { created_by?: string }).created_by },
    title: newStatus === "accepted" ? `Quote ${quote.ref} accepted` : `Quote ${quote.ref} declined`,
    body: `${customerName} ${newStatus} ${quote.ref}.`,
    href: `/quoting/${quote.id}`,
    emailDetails: [
      { label: "Quote", value: quote.ref },
      { label: "Customer", value: customerName },
      { label: "Site", value: q.site_name ?? "" },
      { label: "Amount", value: quoteTotal > 0 ? `$${quoteTotal.toFixed(2)} ex GST` : "" },
      { label: "Job", value: linkedJobNumber ?? "" },
      {
        label: "Responded",
        value: new Date().toLocaleString("en-AU", {
          timeZone: "Australia/Brisbane",
          dateStyle: "medium",
          timeStyle: "short",
        }),
      },
    ],
    ctaLabel: `View Quote ${quote.ref}`,
  });

  // Auto-transition linked job + sync the scope-of-works into the job's
  // description. On accept we backfill the SoW in case the quote was sent
  // before the send-time sync existed; on decline we still update so the
  // job description reflects the latest scope at the time of decision.
  if (quote.job_id) {
    const jobAction = action === "accept" ? "quote_accepted" : "quote_declined";
    await autoTransitionJobStatusServer(quote.job_id, jobAction, supabase);
    try {
      await syncQuoteScopeToJob(supabase, quote.id);
    } catch {
      // Best-effort — don't block the customer's response on a sync hiccup.
    }
    // Straight-through jobs (non-progress / small) become procurement-ready on
    // accept — ping whoever raises POs. Progress jobs notify later on PP1 paid.
    if (action === "accept") {
      await notifyProcurementReadyIfEligible(createServiceRoleClient(), quote.job_id);
    }
  }

  // Auto-create the Xero invoice on accept. This is a best-effort sidecar:
  // any failure is recorded on the quote but MUST NOT break the customer's
  // accept response. Staff can retry from the quote detail page.
  if (action === "accept") {
    const attemptedAt = new Date().toISOString();
    try {
      // Service role — this route runs as the anonymous CUSTOMER, whose
      // session can't read xero_connections or insert invoices past RLS.
      await createInvoiceFromAcceptedQuote(createServiceRoleClient(), quote.id);
      await supabase
        .from("quotes")
        .update({
          auto_invoice_attempted_at: attemptedAt,
          auto_invoice_error: null,
        })
        .eq("id", quote.id);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await supabase
        .from("quotes")
        .update({
          auto_invoice_attempted_at: attemptedAt,
          auto_invoice_error: message.slice(0, 500),
        })
        .eq("id", quote.id);
      // Deliberately not rethrown — customer accept should never fail due to
      // downstream invoice creation issues.
    }
  }

  return NextResponse.json({ success: true, status: newStatus, ref: quote.ref });
}
