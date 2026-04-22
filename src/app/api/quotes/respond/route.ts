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

  const { data: quote, error } = await supabase
    .from("quotes")
    .select("id, status, ref, job_id")
    .eq("response_token", token)
    .single();

  if (error || !quote) {
    return NextResponse.json({ error: "Quote not found or link expired" }, { status: 404 });
  }

  if (quote.status !== "sent") {
    return NextResponse.json({ error: `Quote has already been ${quote.status}` }, { status: 400 });
  }

  const newStatus = action === "accept" ? "accepted" : "declined";
  const update: Record<string, unknown> = {
    status: newStatus,
    [`${newStatus}_at`]: new Date().toISOString(),
  };

  await supabase.from("quotes").update(update).eq("id", quote.id);

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
