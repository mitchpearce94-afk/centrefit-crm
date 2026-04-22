import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { autoTransitionJobStatusServer } from "@/lib/job-status-transitions";
import { createInvoiceFromAcceptedQuote } from "@/lib/invoices/create-from-quote";

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
  const update: Record<string, unknown> = {
    status: newStatus,
    [`${newStatus}_at`]: new Date().toISOString(),
  };

  const { data: updated, error: updateError } = await supabase
    .from("quotes")
    .update(update)
    .eq("response_token", token)
    .eq("status", "sent")
    .select("id, ref, job_id")
    .maybeSingle();

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 });
  }

  if (!updated) {
    // Either the token is invalid OR the quote has already been responded to.
    // Fetch to tell them which.
    const { data: existing } = await supabase
      .from("quotes")
      .select("status, ref")
      .eq("response_token", token)
      .maybeSingle();
    if (!existing) {
      return NextResponse.json({ error: "Quote not found or link expired" }, { status: 404 });
    }
    return NextResponse.json(
      { error: `Quote has already been ${existing.status}` },
      { status: 400 },
    );
  }

  const quote = updated;

  // Auto-transition linked job
  if (quote.job_id) {
    const jobAction = action === "accept" ? "quote_accepted" : "quote_declined";
    await autoTransitionJobStatusServer(quote.job_id, jobAction, supabase);
  }

  // Auto-create the Xero invoice on accept. This is a best-effort sidecar:
  // any failure is recorded on the quote but MUST NOT break the customer's
  // accept response. Staff can retry from the quote detail page.
  if (action === "accept") {
    const attemptedAt = new Date().toISOString();
    try {
      await createInvoiceFromAcceptedQuote(supabase, quote.id);
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
