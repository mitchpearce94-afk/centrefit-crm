import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { sendSupplierRFQ, type RFQLine } from "@/lib/emails/supplier-rfq";

/**
 * Send pricing request emails to one or more suppliers for the quote's BOM.
 *
 * Body (all optional):
 *   {
 *     supplierIds?: string[]   // scope to these suppliers only; absent = all
 *                              // suppliers referenced by the quote's lines
 *   }
 *
 * For each supplier:
 *   1. Look up their lines in the quote
 *   2. Send an email listing those lines + asking for current pricing
 *   3. Stamp rfq_sent_at on each line
 *
 * Returns per-supplier send summary + failures.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: quoteId } = await params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  let body: { supplierIds?: string[] } = {};
  try {
    const text = await req.text();
    if (text) body = JSON.parse(text);
  } catch {
    // ignore — empty body is fine
  }

  const { data: quote, error: quoteErr } = await supabase
    .from("quotes")
    .select("id, ref, site_name, client_name, job:jobs(number)")
    .eq("id", quoteId)
    .single();
  if (quoteErr || !quote) {
    return NextResponse.json({ error: "Quote not found" }, { status: 404 });
  }
  const jobNumber = Array.isArray(quote.job)
    ? quote.job[0]?.number ?? null
    : (quote.job as { number?: string } | null)?.number ?? null;

  const { data: lineItems, error: liErr } = await supabase
    .from("quote_line_items")
    .select(`
      id, product_name, sku, quantity, cost_price,
      quote_products ( supplier_id, cost_updated_at )
    `)
    .eq("quote_id", quoteId);
  if (liErr) return NextResponse.json({ error: liErr.message }, { status: 500 });
  if (!lineItems || lineItems.length === 0) {
    return NextResponse.json({ error: "Quote has no line items" }, { status: 400 });
  }

  // Skip lines whose catalog price was confirmed in the last 30 days —
  // those are considered fresh and don't need another RFQ round.
  const FRESH_WINDOW_MS = 30 * 86400 * 1000;
  const now = Date.now();

  // Group lines by supplier_id
  type Row = {
    id: string;
    product_name: string;
    sku: string | null;
    quantity: number;
    cost_price: number | null;
    quote_products: { supplier_id: string | null; cost_updated_at: string | null } | null;
  };
  const typed = lineItems as unknown as Row[];
  const linesBySupplier = new Map<string, Row[]>();
  const skippedFresh: { lineId: string; productName: string; freshAt: string }[] = [];

  for (const row of typed) {
    const sid = row.quote_products?.supplier_id;
    if (!sid) continue;
    if (body.supplierIds && !body.supplierIds.includes(sid)) continue;

    const costUpdatedAt = row.quote_products?.cost_updated_at;
    if (costUpdatedAt) {
      const age = now - new Date(costUpdatedAt).getTime();
      if (age < FRESH_WINDOW_MS) {
        skippedFresh.push({
          lineId: row.id,
          productName: row.product_name,
          freshAt: costUpdatedAt,
        });
        continue;
      }
    }

    const list = linesBySupplier.get(sid) ?? [];
    list.push(row);
    linesBySupplier.set(sid, list);
  }

  if (linesBySupplier.size === 0) {
    if (skippedFresh.length > 0) {
      return NextResponse.json(
        {
          ok: true,
          sent: [],
          failures: [],
          skippedFresh,
          message: `All lines have prices confirmed within the last 30 days — nothing to send.`,
        },
      );
    }
    return NextResponse.json(
      { error: "No lines with an assigned supplier — set supplier on products first" },
      { status: 400 },
    );
  }

  const { data: suppliers, error: sErr } = await supabase
    .from("suppliers")
    .select("id, name, email")
    .in("id", Array.from(linesBySupplier.keys()));
  if (sErr) return NextResponse.json({ error: sErr.message }, { status: 500 });

  const supplierById = new Map<string, { id: string; name: string; email: string | null }>();
  for (const s of suppliers ?? []) supplierById.set(s.id, s);

  const sent: { supplierId: string; supplierName: string; lineCount: number }[] = [];
  const failures: { supplierId: string; supplierName?: string; message: string }[] = [];
  const stampedLineIds: string[] = [];

  for (const [supplierId, rows] of linesBySupplier) {
    const supplier = supplierById.get(supplierId);
    if (!supplier) {
      failures.push({ supplierId, message: "Supplier record not found" });
      continue;
    }
    if (!supplier.email) {
      failures.push({
        supplierId,
        supplierName: supplier.name,
        message: "Supplier has no email address on file",
      });
      continue;
    }

    const rfqLines: RFQLine[] = rows.map((r) => ({
      productName: r.product_name,
      sku: r.sku,
      quantity: Number(r.quantity),
      lastKnownCost: r.cost_price !== null ? Number(r.cost_price) : null,
    }));

    try {
      await sendSupplierRFQ({
        supplierName: supplier.name,
        supplierEmail: supplier.email,
        quoteRef: quote.ref,
        jobNumber,
        siteName: quote.site_name ?? quote.client_name ?? null,
        lines: rfqLines,
      });

      sent.push({ supplierId, supplierName: supplier.name, lineCount: rows.length });
      stampedLineIds.push(...rows.map((r) => r.id));
    } catch (err) {
      failures.push({
        supplierId,
        supplierName: supplier.name,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  if (stampedLineIds.length > 0) {
    await supabase
      .from("quote_line_items")
      .update({ rfq_sent_at: new Date().toISOString() })
      .in("id", stampedLineIds);
  }

  return NextResponse.json({
    ok: failures.length === 0,
    sent,
    failures,
    skippedFresh,
  });
}
