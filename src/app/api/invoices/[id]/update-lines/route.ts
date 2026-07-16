import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getAuthedClient } from "@/lib/xero/client";
import { updateXeroInvoiceLines } from "@/lib/xero/invoices";
import { logDocumentActivity } from "@/lib/activity/log";
import { assertXeroAvailable, captureXeroRateLimit } from "@/lib/xero/rate-limit";

interface InboundLine {
  description: string;
  quantity?: number;
  /** Absent/null = description-only row (text line with no charge in Xero). */
  unitAmount?: number | null;
  accountCode?: string;
  taxType?: string;
}

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const supabase = await createClient();

  const body = (await req.json().catch(() => null)) as
    | { lineItems?: InboundLine[] }
    | null;
  const lineItems = body?.lineItems;
  if (!Array.isArray(lineItems) || lineItems.length === 0) {
    return NextResponse.json(
      { error: "lineItems required (at least one)" },
      { status: 400 },
    );
  }
  for (const li of lineItems) {
    if (!li?.description?.trim()) {
      return NextResponse.json(
        { error: "Every line item needs a description" },
        { status: 400 },
      );
    }
    // Description-only rows (unitAmount absent) carry no charge — skip the
    // amount validation for those.
    if (li.unitAmount == null) continue;
    if (typeof li.unitAmount !== "number" || !Number.isFinite(li.unitAmount)) {
      return NextResponse.json(
        { error: "Every priced line item needs a valid unit amount" },
        { status: 400 },
      );
    }
  }
  if (!lineItems.some((li) => li.unitAmount != null)) {
    return NextResponse.json(
      { error: "At least one line item must carry an amount" },
      { status: 400 },
    );
  }

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
      {
        error: `Only draft invoices can be edited (this one is ${invoice.status}). Edit in Xero or void and re-create.`,
      },
      { status: 409 },
    );
  }

  try {
    await assertXeroAvailable(supabase);
  } catch (err: unknown) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Xero unavailable" },
      { status: 429 },
    );
  }

  // Normalise before the Xero call: description-only rows keep ONLY their
  // description (any other field would turn them into $0.00 priced rows).
  const cleanedLines = lineItems.map((li) =>
    li.unitAmount == null
      ? { description: li.description }
      : {
          description: li.description,
          quantity: li.quantity ?? 1,
          unitAmount: li.unitAmount,
          accountCode: li.accountCode ?? "200",
          taxType: li.taxType ?? "OUTPUT",
        },
  );

  let totals;
  try {
    const { client, conn } = await getAuthedClient();
    totals = await updateXeroInvoiceLines({
      xero: client,
      tenantId: conn.tenant_id,
      xeroInvoiceId: invoice.xero_invoice_id,
      lineItems: cleanedLines,
    });
  } catch (err: unknown) {
    await captureXeroRateLimit(supabase, err);
    const message = err instanceof Error ? err.message : String(err);
    await supabase
      .from("invoices")
      .update({
        xero_last_error: message,
        xero_last_synced_at: new Date().toISOString(),
      })
      .eq("id", id);
    return NextResponse.json(
      { error: `Xero error: ${message}` },
      { status: 502 },
    );
  }

  const { data: updated, error: updErr } = await supabase
    .from("invoices")
    .update({
      line_items: cleanedLines,
      subtotal: totals.subTotal,
      gst: totals.totalTax,
      total: totals.total,
      amount_due: totals.amountDue,
      xero_last_synced_at: new Date().toISOString(),
      xero_last_error: null,
    })
    .eq("id", id)
    .select()
    .single();
  if (updErr) {
    return NextResponse.json({ error: updErr.message }, { status: 500 });
  }

  await logDocumentActivity({
    supabase,
    documentType: "invoice",
    documentId: id,
    eventType: "invoice.lines_updated",
    metadata: {
      line_count: lineItems.length,
      total: totals.total,
    },
  });

  return NextResponse.json({ invoice: updated });
}
