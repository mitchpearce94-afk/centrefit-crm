import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { procurementPaymentBlock } from "@/lib/procurement/payment-gate";

/**
 * Initialise OR top-up the procurement list from the job's accepted quote.
 *
 * Originally this short-circuited whenever any rows existed, which broke on
 * re-quoted jobs (Snap CBD, 2026-07-14): editing a quote regenerates its
 * line items, orphaning the procurement rows that pointed at the old ids —
 * and the new BOM could then never enter procurement.
 *
 * Now it syncs: every orderable line on the accepted quote that has no live
 * procurement row gets one. Orphaned rows (their quote_line_item_id no
 * longer exists) act as per-product COVERAGE — parts already
 * bought/received under the old quote revision aren't re-ordered; only the
 * shortfall quantity is created. Never deletes or edits existing rows.
 *
 * Idempotent: run it twice, the second run creates nothing.
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: jobId } = await params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  // Find the accepted quote. Most recent wins if multiple.
  const { data: quote, error: quoteErr } = await supabase
    .from("quotes")
    .select("id, status, accepted_at, ref")
    .eq("job_id", jobId)
    .eq("status", "accepted")
    .order("accepted_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (quoteErr) {
    return NextResponse.json({ error: quoteErr.message }, { status: 500 });
  }
  if (!quote) {
    return NextResponse.json(
      { error: "No accepted quote found for this job" },
      { status: 400 },
    );
  }

  // Pull the BOM with supplier info via the linked product
  const { data: lineItems, error: liErr } = await supabase
    .from("quote_line_items")
    .select(`
      id, product_id, product_name, sku, quantity, sort_order,
      quote_products ( supplier_id )
    `)
    .eq("quote_id", quote.id)
    .order("sort_order", { ascending: true });

  if (liErr) {
    return NextResponse.json({ error: liErr.message }, { status: 500 });
  }

  // Only catalogue parts get procured — a line is orderable when it's linked
  // to a real product (product_id set) with a positive quantity. This filters
  // out labour placeholders, freeform notes and $0 sundry lines.
  const orderable = (lineItems ?? []).filter(
    (li) => li.product_id != null && Number(li.quantity) > 0,
  );

  // Existing procurement rows for this job, split into:
  //  - live rows: still pointing at a line on the CURRENT accepted quote
  //  - orphans: line deleted by a quote edit (or ad-hoc adds) — these count
  //    as per-product coverage so received stock isn't re-ordered
  const { data: existingRows } = await supabase
    .from("job_procurement_items")
    .select("id, quote_line_item_id, product_id, quantity")
    .eq("job_id", jobId);
  const rows = existingRows ?? [];

  const liveLineIds = new Set(orderable.map((li) => li.id as string));
  const coveredLineIds = new Set(
    rows
      .map((r) => r.quote_line_item_id as string | null)
      .filter((id): id is string => id != null && liveLineIds.has(id)),
  );

  // Per-product coverage pool from orphaned rows.
  const coverage = new Map<string, number>();
  for (const r of rows) {
    const lineId = r.quote_line_item_id as string | null;
    if (lineId != null && liveLineIds.has(lineId)) continue; // live row
    const pid = (r.product_id as string | null) ?? "";
    if (!pid) continue;
    coverage.set(pid, (coverage.get(pid) ?? 0) + Number(r.quantity));
  }

  // Lines needing a row, with orphan coverage consumed per product.
  type NewRow = {
    job_id: string;
    quote_line_item_id: string;
    product_id: string | null;
    product_name: string;
    sku: string | null;
    default_supplier_id: string | null;
    actual_supplier_id: string | null;
    quantity: number;
    status: string;
  };
  const newRows: NewRow[] = [];
  let coveredByHistory = 0;
  for (const li of orderable) {
    if (coveredLineIds.has(li.id as string)) continue;
    const pid = li.product_id as string;
    const qty = Number(li.quantity);
    const pool = coverage.get(pid) ?? 0;
    const take = Math.min(pool, qty);
    if (take > 0) {
      coverage.set(pid, pool - take);
      coveredByHistory += take;
    }
    const need = qty - take;
    if (need <= 0) continue;
    const productRow = li.quote_products as { supplier_id?: string | null } | null;
    const supplierId = productRow?.supplier_id ?? null;
    newRows.push({
      job_id: jobId,
      quote_line_item_id: li.id as string,
      product_id: pid,
      product_name: li.product_name,
      sku: li.sku ?? null,
      default_supplier_id: supplierId,
      actual_supplier_id: supplierId,
      quantity: need,
      status: "pending",
    });
  }

  if (newRows.length === 0) {
    if (rows.length === 0 && orderable.length === 0) {
      return NextResponse.json(
        { error: "This quote has no orderable parts (labour-only) — nothing to procure." },
        { status: 400 },
      );
    }
    return NextResponse.json({
      ok: true,
      alreadyInitialised: true,
      created: 0,
      coveredByHistory,
      quoteRef: quote.ref,
    });
  }

  // Payment gate — a job only enters/extends procurement once its invoices
  // are paid. Checked only when we're actually about to create rows.
  const blocked = await procurementPaymentBlock(supabase, jobId);
  if (blocked) {
    return NextResponse.json({ error: blocked }, { status: 400 });
  }

  const { data: inserted, error: insErr } = await supabase
    .from("job_procurement_items")
    .insert(newRows)
    .select("id");

  if (insErr) {
    return NextResponse.json({ error: insErr.message }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    created: inserted?.length ?? 0,
    coveredByHistory,
    quoteRef: quote.ref,
  });
}
