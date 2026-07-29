import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { sendInvoiceEmail } from "@/lib/emails/invoice-send";
import { getAuthedClient } from "@/lib/xero/client";
import {
  markXeroInvoiceSent,
  fetchXeroOnlineInvoiceUrl,
  fetchXeroInvoicePdf,
} from "@/lib/xero/invoices";
import { captureXeroRateLimit } from "@/lib/xero/rate-limit";
import { logDocumentActivity } from "@/lib/activity/log";
import { enqueueNotification } from "@/lib/notifications/enqueue";

/**
 * Email an invoice to the customer from accounts@centrefit.com.au.
 *
 * Inputs: { email: string }. For Xero-linked invoices the email carries the
 * Xero PDF as an attachment and the online pay link. Invoices that entered
 * the CRM via Xero-side sync (imports, webhook) have no stored pay link, so
 * it's fetched and backfilled here. If NEITHER the link nor the PDF can be
 * obtained, the send is refused — a bare "here's a total" email with no way
 * to view or pay the invoice is worse than no email (Mitchell, 2026-07-29).
 */
export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const body = await req.json().catch(() => ({}));
  const email = (body?.email ?? "").trim();
  if (!email) {
    return NextResponse.json({ error: "Recipient email required" }, { status: 400 });
  }

  const supabase = await createClient();

  const { data: invoice, error } = await supabase
    .from("invoices")
    .select(`
      id, invoice_type, status, total, amount_due, due_date,
      xero_invoice_id, xero_invoice_number, xero_online_url,
      customer:customers(id, name, customer_contacts(name, email, is_primary))
    `)
    .eq("id", id)
    .single();
  if (error || !invoice) {
    return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
  }

  type CustomerWithContacts = {
    id: string;
    name: string;
    customer_contacts: { name: string | null; email: string | null; is_primary: boolean | null }[];
  };
  const customer: CustomerWithContacts | null = Array.isArray(invoice.customer)
    ? (invoice.customer[0] as CustomerWithContacts | undefined) ?? null
    : (invoice.customer as CustomerWithContacts | null);
  const customerName = customer?.name ?? "—";
  const contacts = customer?.customer_contacts ?? [];
  const matchedContact =
    contacts.find((c) => c.email && c.email.toLowerCase() === email.toLowerCase()) ??
    contacts.find((c) => c.is_primary) ??
    contacts[0] ??
    null;
  const firstName = matchedContact?.name?.trim().split(/\s+/)[0] ?? null;

  const ref = invoice.xero_invoice_number ?? invoice.id.slice(0, 8);

  // Gather what the email actually needs from Xero before sending: the pay
  // link (backfilled onto the row if missing) and the invoice PDF.
  let payUrl: string | null = invoice.xero_online_url ?? null;
  let pdfBuffer: Buffer | null = null;
  let xeroCtx: { client: Awaited<ReturnType<typeof getAuthedClient>>["client"]; tenantId: string } | null = null;

  if (invoice.xero_invoice_id) {
    try {
      const { client, conn } = await getAuthedClient();
      xeroCtx = { client, tenantId: conn.tenant_id };
    } catch (err) {
      await captureXeroRateLimit(supabase, err);
      console.error(`[invoice.send] Xero client unavailable for ${id}:`, err);
    }

    if (xeroCtx && !payUrl) {
      try {
        payUrl = await fetchXeroOnlineInvoiceUrl(xeroCtx.client, xeroCtx.tenantId, invoice.xero_invoice_id);
        if (payUrl) {
          await supabase.from("invoices").update({ xero_online_url: payUrl }).eq("id", id);
        }
      } catch (err) {
        await captureXeroRateLimit(supabase, err);
        console.error(`[invoice.send] couldn't fetch online invoice URL for ${id}:`, err);
      }
    }

    if (xeroCtx) {
      try {
        pdfBuffer = await fetchXeroInvoicePdf(xeroCtx.client, xeroCtx.tenantId, invoice.xero_invoice_id);
      } catch (err) {
        await captureXeroRateLimit(supabase, err);
        console.error(`[invoice.send] couldn't fetch invoice PDF for ${id}:`, err);
      }
    }

    // A Xero-linked invoice with no link AND no PDF would be a useless email —
    // just a dollar figure with nothing to view or pay. Refuse instead.
    if (!payUrl && !pdfBuffer) {
      return NextResponse.json(
        { error: "Couldn't fetch the pay link or PDF from Xero, so the email would only contain a total. Nothing was sent — try again shortly." },
        { status: 502 },
      );
    }
  }

  const sendResult = await sendInvoiceEmail({
    to: email,
    invoiceRef: ref,
    customerName,
    contactFirstName: firstName,
    total: Number(invoice.total) || 0,
    dueDate: invoice.due_date ?? null,
    invoiceType: invoice.invoice_type ?? "full",
    payUrl,
    invoiceId: invoice.id,
    pdfBuffer,
  });
  if (!sendResult.ok) {
    return NextResponse.json({ error: sendResult.error }, { status: 502 });
  }

  await supabase
    .from("invoices")
    .update({
      sent_at: new Date().toISOString(),
      sent_to_email: email,
    })
    .eq("id", id);

  // Reflect "sent" back into Xero (SentToContact=true) so its UI shows the
  // invoice as Sent for tracking. Best-effort — the customer already has the
  // email; a Xero hiccup here shouldn't fail the send.
  if (invoice.xero_invoice_id && xeroCtx) {
    try {
      await markXeroInvoiceSent(xeroCtx.client, xeroCtx.tenantId, invoice.xero_invoice_id);
    } catch (err) {
      console.error(`[invoice.send] couldn't set SentToContact in Xero for ${id}:`, err);
    }
  }

  await logDocumentActivity({
    supabase,
    documentType: "invoice",
    documentId: id,
    eventType: "invoice.sent",
    metadata: { to: email, ref },
  });

  await enqueueNotification({
    supabase,
    typeCode: "invoice.sent",
    refType: "invoice",
    refId: id,
    audience: { allActive: true },
    title: `Invoice ${ref} emailed`,
    body: `${customerName} — sent to ${email}`,
    href: `/invoices/${id}`,
  });

  return NextResponse.json({ ok: true });
}
