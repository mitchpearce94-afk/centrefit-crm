import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { procurementPaymentBlock } from "@/lib/procurement/payment-gate";

/**
 * Initialise the procurement list for a job from its accepted quote's BOM.
 * Idempotent: if rows already exist, returns the existing set without
 * creating duplicates.
 *
 * Only the job's accepted quote is considered. If there are multiple
 * accepted quotes (progress re-quote scenario) we use the most recent.
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

  // Short-circuit if already initialised
  const { data: existing } = await supabase
    .from("job_procurement_items")
    .select("id")
    .eq("job_id", jobId)
    .limit(1);
  if (existing && existing.length > 0) {
    return NextResponse.json({ ok: true, alreadyInitialised: true, count: existing.length });
  }

  // Payment gate — a job only enters procurement once its invoices are paid.
  const blocked = await procurementPaymentBlock(supabase, jobId);
  if (blocked) {
    return NextResponse.json({ error: blocked }, { status: 400 });
  }

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
      id, product_id, product_name, sku, quantity,
      quote_products ( supplier_id )
    `)
    .eq("quote_id", quote.id)
    .order("sort_order", { ascending: true });

  if (liErr) {
    return NextResponse.json({ error: liErr.message }, { status: 500 });
  }
  if (!lineItems || lineItems.length === 0) {
    return NextResponse.json(
      { error: "Accepted quote has no line items to procure" },
      { status: 400 },
    );
  }

  // Only catalogue parts get procured — a line is orderable when it's linked
  // to a real product (product_id set) with a positive quantity. This filters
  // out labour placeholders, freeform notes and $0 sundry lines so a
  // labour-only job never spawns an empty procurement list.
  const orderable = lineItems.filter(
    (li) => li.product_id != null && Number(li.quantity) > 0,
  );
  if (orderable.length === 0) {
    return NextResponse.json(
      {
        error:
          "This quote has no orderable parts (labour-only) — nothing to procure.",
      },
      { status: 400 },
    );
  }

  const rows = orderable.map((li) => {
    const productRow = li.quote_products as { supplier_id?: string | null } | null;
    const supplierId = productRow?.supplier_id ?? null;
    return {
      job_id: jobId,
      quote_line_item_id: li.id,
      product_id: li.product_id ?? null,
      product_name: li.product_name,
      sku: li.sku ?? null,
      default_supplier_id: supplierId,
      actual_supplier_id: supplierId,
      quantity: li.quantity,
      status: "pending",
    };
  });

  const { data: inserted, error: insErr } = await supabase
    .from("job_procurement_items")
    .insert(rows)
    .select("id");

  if (insErr) {
    return NextResponse.json({ error: insErr.message }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    created: inserted?.length ?? 0,
    quoteRef: quote.ref,
  });
}
