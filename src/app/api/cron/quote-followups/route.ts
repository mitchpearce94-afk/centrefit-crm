import { NextRequest, NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { sendQuoteFollowupEmail } from "@/lib/emails/quote-followup";
import { logDocumentActivity } from "@/lib/activity/log";
import { enqueueNotification } from "@/lib/notifications/enqueue";

/**
 * Daily cron — finds quotes that have been "sent" for 7+ days with no
 * acceptance / decline / prior follow-up, fires the auto follow-up
 * email from sales@, stamps quotes.followup_sent_at + followup_count,
 * and notifies subscribed staff (quote.followup_sent only — the chase has
 * already happened so we don't also fire quote.followup_due).
 *
 * Auth: header X-Cf-Cron-Secret must match CRON_SECRET env. Vercel
 * Cron forwards X-Cf-Cron-Secret automatically when the path is in
 * vercel.json's `crons`.
 */

const FOLLOWUP_AGE_DAYS = 7;

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const provided = req.headers.get("x-cf-cron-secret") ?? req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!secret) {
    return NextResponse.json({ error: "CRON_SECRET not configured" }, { status: 500 });
  }
  if (provided !== secret) {
    return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  }

  const supabase = createServiceRoleClient();
  const cutoff = new Date(Date.now() - FOLLOWUP_AGE_DAYS * 24 * 3600 * 1000).toISOString();

  // Eligible: sent status, sent >= 7d ago, never followed up before,
  // no acceptance/decline yet (status === "sent" already implies that).
  const { data: due, error } = await supabase
    .from("quotes")
    .select(`
      id, ref, status, sent_at, sent_to_email, response_token,
      site_name, client_name, followup_count,
      customer:customers(id, name, customer_contacts(name, email, is_primary))
    `)
    .eq("status", "sent")
    .lte("sent_at", cutoff)
    .is("followup_sent_at", null)
    .limit(50);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "https://crm.centrefit.com.au";
  const results: Array<{ id: string; ref: string; ok: boolean; error?: string; to?: string }> = [];

  for (const quote of due ?? []) {
    type CustomerRow = {
      id: string;
      name: string;
      customer_contacts: { name: string | null; email: string | null; is_primary: boolean | null }[];
    };
    const customer: CustomerRow | null = Array.isArray(quote.customer)
      ? (quote.customer[0] as CustomerRow | undefined) ?? null
      : (quote.customer as CustomerRow | null);
    const recipientEmail = quote.sent_to_email
      ?? customer?.customer_contacts?.find((c) => c.is_primary)?.email
      ?? customer?.customer_contacts?.[0]?.email
      ?? null;
    if (!recipientEmail || !quote.response_token) {
      results.push({ id: quote.id, ref: quote.ref, ok: false, error: "missing recipient or token" });
      continue;
    }
    const matchedContact =
      customer?.customer_contacts?.find((c) => c.email && recipientEmail && c.email.toLowerCase() === recipientEmail.toLowerCase()) ??
      customer?.customer_contacts?.find((c) => c.is_primary) ??
      customer?.customer_contacts?.[0] ??
      null;
    const firstName = matchedContact?.name?.trim().split(/\s+/)[0] ?? null;

    const sentAtMs = quote.sent_at ? new Date(quote.sent_at).getTime() : Date.now();
    const daysSinceSent = Math.max(1, Math.floor((Date.now() - sentAtMs) / 86_400_000));

    const sendResult = await sendQuoteFollowupEmail({
      to: recipientEmail,
      quoteRef: quote.ref,
      quoteId: quote.id,
      customerName: customer?.name ?? quote.client_name ?? "—",
      contactFirstName: firstName,
      siteName: quote.site_name ?? null,
      respondUrl: `${baseUrl}/quote-response/${quote.response_token}`,
      daysSinceSent,
    });

    if (!sendResult.ok) {
      results.push({ id: quote.id, ref: quote.ref, ok: false, error: sendResult.error, to: recipientEmail });
      continue;
    }

    await supabase
      .from("quotes")
      .update({
        followup_sent_at: new Date().toISOString(),
        followup_count: (quote.followup_count ?? 0) + 1,
      })
      .eq("id", quote.id);

    await logDocumentActivity({
      supabase,
      documentType: "quote",
      documentId: quote.id,
      eventType: "quote.followup_sent",
      metadata: { to: recipientEmail, days_since_sent: daysSinceSent },
    });

    await enqueueNotification({
      supabase,
      typeCode: "quote.followup_sent",
      refType: "quote",
      refId: quote.id,
      audience: { allActive: true },
      title: `Auto follow-up sent for ${quote.ref}`,
      body: `${customer?.name ?? quote.client_name ?? ""} — ${daysSinceSent} days after the original send`,
      href: `/quoting/${quote.id}`,
    });

    results.push({ id: quote.id, ref: quote.ref, ok: true, to: recipientEmail });
  }

  const okCount = results.filter((r) => r.ok).length;
  const failCount = results.length - okCount;
  return NextResponse.json({
    ok: true,
    summary: { eligible: results.length, sent: okCount, failed: failCount },
    results,
  });
}
