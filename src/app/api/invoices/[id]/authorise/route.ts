import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getAuthedClient } from "@/lib/xero/client";
import { authoriseXeroInvoice } from "@/lib/xero/invoices";
import { autoTransitionJobStatusServer } from "@/lib/job-status-transitions.server";
import { logDocumentActivity } from "@/lib/activity/log";
import { enqueueNotification } from "@/lib/notifications/enqueue";

export async function POST(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const supabase = await createClient();

  const { data: invoice, error } = await supabase
    .from("invoices")
    .select("id, xero_invoice_id, status, job_id, invoice_type")
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
  if (invoice.status !== "draft") {
    return NextResponse.json(
      { error: `Invoice is already ${invoice.status} — only drafts can be authorised` },
      { status: 409 },
    );
  }

  let result;
  try {
    const { client, conn } = await getAuthedClient();
    result = await authoriseXeroInvoice(client, conn.tenant_id, invoice.xero_invoice_id);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    await supabase
      .from("invoices")
      .update({ xero_last_error: message, xero_last_synced_at: new Date().toISOString() })
      .eq("id", id);
    return NextResponse.json({ error: `Xero error: ${message}` }, { status: 502 });
  }

  const { data: updated, error: updErr } = await supabase
    .from("invoices")
    .update({
      status: "authorised",
      xero_online_url: result.onlineInvoiceUrl,
      xero_last_synced_at: new Date().toISOString(),
      xero_last_error: null,
    })
    .eq("id", id)
    .select()
    .single();
  if (updErr) {
    return NextResponse.json({ error: updErr.message }, { status: 500 });
  }

  // Auto-transition the linked job:
  //   - If the job is in "Ready to Invoice", any invoice authorisation marks
  //     it Complete (invoice_sent rule). Covers PP2 finals, full invoices on
  //     wrapped jobs, and variance invoices on completed work.
  //   - Otherwise PP1 / full invoices park the job at "Awaiting Invoice
  //     Payment" until the Xero webhook confirms payment.
  if (invoice.job_id) {
    const { data: jobRow } = await supabase
      .from("jobs")
      .select("status:statuses(name)")
      .eq("id", invoice.job_id)
      .single();
    const statusField = jobRow?.status as { name: string } | { name: string }[] | null | undefined;
    const currentStatus = Array.isArray(statusField)
      ? statusField[0]?.name
      : statusField?.name;
    const action = currentStatus === "Ready to Invoice" ? "invoice_sent" : "invoice_authorised";
    try {
      await autoTransitionJobStatusServer(invoice.job_id, action, supabase);
    } catch (err) {
      console.error(`[authorise] auto-transition failed for job ${invoice.job_id}:`, err);
    }
  }

  await logDocumentActivity({
    supabase,
    documentType: "invoice",
    documentId: id,
    eventType: "invoice.authorised",
    metadata: { online_url: result.onlineInvoiceUrl ?? null },
  });

  await enqueueNotification({
    supabase,
    typeCode: "invoice.authorised",
    refType: "invoice",
    refId: id,
    audience: { allActive: true },
    title: "Invoice authorised in Xero",
    body: result.onlineInvoiceUrl ? "Ready to email or share online link." : undefined,
    href: `/invoices/${id}`,
  });

  return NextResponse.json({ invoice: updated });
}
