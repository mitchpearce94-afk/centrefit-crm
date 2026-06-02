import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getAuthedClient } from "@/lib/xero/client";
import { fetchXeroInvoice } from "@/lib/xero/invoices";
import { logDocumentActivity } from "@/lib/activity/log";
import {
  isXeroRateLimited,
  captureXeroRateLimit,
} from "@/lib/xero/rate-limit";

export async function POST(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const supabase = await createClient();

  const { data: invoice, error } = await supabase
    .from("invoices")
    .select("id, xero_invoice_id, total, status")
    .eq("id", id)
    .single();
  if (error || !invoice) {
    return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
  }
  if (!invoice.xero_invoice_id) {
    return NextResponse.json(
      { error: "Invoice is not linked to a Xero invoice" },
      { status: 400 },
    );
  }

  // Short-circuit if we know we're rate-limited — don't waste a Xero call,
  // give the UI a friendly explainer instead of a 502.
  const limited = await isXeroRateLimited(supabase);
  if (limited) {
    const minutesLeft = Math.ceil((limited.until.getTime() - Date.now()) / 60000);
    return NextResponse.json(
      {
        error: `Xero daily quota exhausted. Try again in ~${minutesLeft} minute${minutesLeft === 1 ? "" : "s"} (resumes ${limited.until.toLocaleString("en-AU", { timeZone: "Australia/Brisbane", hour: "2-digit", minute: "2-digit" })} Brisbane time).`,
        rateLimited: true,
        retryAt: limited.until.toISOString(),
      },
      { status: 429 },
    );
  }

  let latest;
  try {
    const { client, conn } = await getAuthedClient();
    latest = await fetchXeroInvoice(client, conn.tenant_id, invoice.xero_invoice_id);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    const wasRateLimit = await captureXeroRateLimit(supabase, err);
    await supabase
      .from("invoices")
      .update({ xero_last_error: message, xero_last_synced_at: new Date().toISOString() })
      .eq("id", id);
    if (wasRateLimit) {
      return NextResponse.json(
        { error: "Xero rate-limited. Cooldown recorded; please try again later.", rateLimited: true },
        { status: 429 },
      );
    }
    return NextResponse.json({ error: `Xero error: ${message}` }, { status: 502 });
  }

  const status = latest.status.toLowerCase();
  const normalisedStatus =
    status === "paid" ? "paid"
    : status === "voided" ? "void"
    : status === "draft" ? "draft"
    : "authorised";

  const { data: updated, error: updErr } = await supabase
    .from("invoices")
    .update({
      amount_due: latest.amountDue,
      amount_paid: latest.amountPaid,
      status: normalisedStatus,
      paid_at: normalisedStatus === "paid"
        ? (latest.fullyPaidOnDate ? new Date(latest.fullyPaidOnDate).toISOString() : new Date().toISOString())
        : null,
      xero_last_synced_at: new Date().toISOString(),
      xero_last_error: null,
    })
    .eq("id", id)
    .select()
    .single();
  if (updErr) {
    return NextResponse.json({ error: updErr.message }, { status: 500 });
  }

  // Log the transition to the activity timeline so a manual refresh that
  // discovers a payment (or void) is recorded — mirrors the Xero webhook,
  // which may be missed/filtered. Only on an actual status change.
  if (invoice.status !== normalisedStatus) {
    await logDocumentActivity({
      supabase,
      documentType: "invoice",
      documentId: id,
      eventType:
        normalisedStatus === "paid" ? "invoice.paid"
        : normalisedStatus === "void" ? "invoice.voided"
        : normalisedStatus === "authorised" ? "invoice.authorised_in_xero"
        : "invoice.status_changed",
      metadata: {
        from: invoice.status,
        to: normalisedStatus,
        amount_due: latest.amountDue,
        amount_paid: latest.amountPaid,
        via: "manual refresh",
      },
    });
  }

  return NextResponse.json({ invoice: updated });
}
