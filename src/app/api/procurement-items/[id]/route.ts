import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * Patch a single procurement item. Allowed mutations:
 *   - status: in_stock | order | pending (can't manually jump to ordered/received)
 *   - actual_supplier_id: staff supplier override
 *   - quantity: edit qty (usually via /split, but raw edits are OK too)
 *   - backorder_note: freeform text
 *
 * Explicitly NOT patchable here:
 *   - ordered_at / xero_po_id — set only by /generate-pos
 *   - received_at / received_by — set only by /receive
 *   - default_supplier_id — initialisation value, immutable
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  let body: {
    status?: string;
    actual_supplier_id?: string | null;
    quantity?: number;
    backorder_note?: string | null;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const update: Record<string, unknown> = {};

  if (body.status !== undefined) {
    const allowed = ["pending", "in_stock", "order"];
    if (!allowed.includes(body.status)) {
      return NextResponse.json(
        { error: `status must be one of ${allowed.join(", ")} — ordered/received are set by other endpoints` },
        { status: 400 },
      );
    }
    update.status = body.status;
  }
  if (body.actual_supplier_id !== undefined) {
    update.actual_supplier_id = body.actual_supplier_id;
  }
  if (body.quantity !== undefined) {
    if (typeof body.quantity !== "number" || body.quantity <= 0) {
      return NextResponse.json({ error: "quantity must be > 0" }, { status: 400 });
    }
    update.quantity = body.quantity;
  }
  if (body.backorder_note !== undefined) {
    update.backorder_note = body.backorder_note;
  }

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: "No patchable fields in request body" }, { status: 400 });
  }

  // Block edits to rows that are already ordered/received — those are
  // effectively immutable from Xero's perspective
  const { data: current, error: fetchErr } = await supabase
    .from("job_procurement_items")
    .select("status")
    .eq("id", id)
    .maybeSingle();
  if (fetchErr) return NextResponse.json({ error: fetchErr.message }, { status: 500 });
  if (!current) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (current.status === "ordered" || current.status === "received") {
    return NextResponse.json(
      { error: `Cannot edit a ${current.status} procurement item` },
      { status: 400 },
    );
  }

  const { data: updated, error: updErr } = await supabase
    .from("job_procurement_items")
    .update(update)
    .eq("id", id)
    .select()
    .single();
  if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 });

  return NextResponse.json({ item: updated });
}

/**
 * Delete a procurement item. Allowed only while status is pending/in_stock/order
 * (i.e. before it's been pushed to Xero).
 */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const { data: current } = await supabase
    .from("job_procurement_items")
    .select("status")
    .eq("id", id)
    .maybeSingle();
  if (!current) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (current.status === "ordered" || current.status === "received") {
    return NextResponse.json(
      { error: `Cannot delete a ${current.status} procurement item` },
      { status: 400 },
    );
  }

  const { error: delErr } = await supabase
    .from("job_procurement_items")
    .delete()
    .eq("id", id);
  if (delErr) return NextResponse.json({ error: delErr.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
