import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * Split one procurement row into two. Common case: 5 cameras → 3 IN STOCK
 * and 2 ORDER. We take the original qty X and a splitQuantity Y (Y < X),
 * clone the row with qty = Y, and reduce the original to qty = (X - Y).
 *
 * The cloned row inherits everything from the original except qty and a
 * fresh id. Staff can then toggle its status / supplier independently.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  let body: { splitQuantity?: number };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const splitQty = Number(body.splitQuantity ?? 0);
  if (!splitQty || splitQty <= 0) {
    return NextResponse.json({ error: "splitQuantity must be > 0" }, { status: 400 });
  }

  const { data: original, error: fetchErr } = await supabase
    .from("job_procurement_items")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (fetchErr) return NextResponse.json({ error: fetchErr.message }, { status: 500 });
  if (!original) return NextResponse.json({ error: "Not found" }, { status: 404 });

  if (original.status === "ordered" || original.status === "received") {
    return NextResponse.json(
      { error: `Cannot split a ${original.status} procurement item` },
      { status: 400 },
    );
  }

  const originalQty = Number(original.quantity);
  if (splitQty >= originalQty) {
    return NextResponse.json(
      { error: `splitQuantity (${splitQty}) must be less than current quantity (${originalQty})` },
      { status: 400 },
    );
  }

  const remaining = originalQty - splitQty;

  // Reduce original's qty
  const { error: updErr } = await supabase
    .from("job_procurement_items")
    .update({ quantity: remaining })
    .eq("id", id);
  if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 });

  // Clone into a new row with the split qty, status reset to pending so staff
  // can triage separately
  const { data: cloned, error: insErr } = await supabase
    .from("job_procurement_items")
    .insert({
      job_id: original.job_id,
      quote_line_item_id: original.quote_line_item_id,
      product_id: original.product_id,
      product_name: original.product_name,
      sku: original.sku,
      default_supplier_id: original.default_supplier_id,
      actual_supplier_id: original.actual_supplier_id,
      quantity: splitQty,
      status: "pending",
      backorder_note: original.backorder_note,
    })
    .select()
    .single();
  if (insErr) {
    // Best-effort rollback of the quantity decrement
    await supabase
      .from("job_procurement_items")
      .update({ quantity: originalQty })
      .eq("id", id);
    return NextResponse.json({ error: insErr.message }, { status: 500 });
  }

  return NextResponse.json({ original: { id, quantity: remaining }, cloned });
}
