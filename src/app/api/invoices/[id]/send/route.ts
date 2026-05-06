import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { sendInvoiceEmail } from "@/lib/emails/invoice-send";
import { logDocumentActivity } from "@/lib/activity/log";
import { enqueueNotification } from "@/lib/notifications/enqueue";

/**
 * Email an invoice to the customer from accounts@centrefit.com.au.
 *
 * Inputs: { email: string, attachPdf?: boolean }. Defaults to no PDF
 * attachment (Xero-hosted online invoice link is preferred for paid
 * invoices); a future iteration can wire in a server-side PDF render.
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

  const sendResult = await sendInvoiceEmail({
    to: email,
    invoiceRef: ref,
    customerName,
    contactFirstName: firstName,
    total: Number(invoice.total) || 0,
    dueDate: invoice.due_date ?? null,
    invoiceType: invoice.invoice_type ?? "full",
    payUrl: invoice.xero_online_url ?? null,
    invoiceId: invoice.id,
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
