import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getAuthedClient } from "@/lib/xero/client";
import { authoriseXeroInvoice } from "@/lib/xero/invoices";

export async function POST(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const supabase = await createClient();

  const { data: invoice, error } = await supabase
    .from("invoices")
    .select("id, xero_invoice_id, status")
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

  return NextResponse.json({ invoice: updated });
}
