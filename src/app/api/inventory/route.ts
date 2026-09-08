import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { currentUserHasPermission } from "@/lib/auth/permissions";
import { checkLowStock } from "@/lib/inventory/low-stock";

/**
 * Start tracking a product in inventory (docs/inventory-CONTEXT.md D2).
 * Creates the inventory_items row at 0 and books the opening balance through
 * the ledger so the first movement is on record like every other one.
 */
export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  if (!(await currentUserHasPermission("inventory.manage"))) {
    return NextResponse.json({ error: "You don't have permission to manage inventory" }, { status: 403 });
  }

  let body: {
    product_id?: string;
    qty_on_hand?: number;
    reorder_point?: number | null;
    reorder_qty?: number | null;
    location?: string | null;
    notes?: string | null;
    alert_staff_id?: string | null;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const productId = (body.product_id ?? "").trim();
  if (!productId) return NextResponse.json({ error: "product_id is required" }, { status: 400 });
  const opening = Number(body.qty_on_hand ?? 0);
  if (!Number.isFinite(opening) || opening < 0) {
    return NextResponse.json({ error: "Opening quantity must be 0 or more" }, { status: 400 });
  }
  const reorderPoint = body.reorder_point == null || body.reorder_point === ("" as unknown) ? null : Number(body.reorder_point);
  if (reorderPoint != null && (!Number.isFinite(reorderPoint) || reorderPoint < 0)) {
    return NextResponse.json({ error: "Reorder point must be 0 or more" }, { status: 400 });
  }
  const reorderQty = body.reorder_qty == null || body.reorder_qty === ("" as unknown) ? null : Number(body.reorder_qty);
  if (reorderQty != null && (!Number.isFinite(reorderQty) || reorderQty <= 0)) {
    return NextResponse.json({ error: "Reorder quantity must be greater than 0" }, { status: 400 });
  }

  const svc = createServiceRoleClient();
  const { data: item, error } = await svc
    .from("inventory_items")
    .insert({
      product_id: productId,
      qty_on_hand: 0,
      reorder_point: reorderPoint,
      reorder_qty: reorderQty,
      location: body.location?.trim() || null,
      notes: body.notes?.trim() || null,
      alert_staff_id: body.alert_staff_id || null,
      created_by: user.id,
    })
    .select("id, product_id")
    .single();
  if (error || !item) {
    if (error?.code === "23505") {
      return NextResponse.json({ error: "That product is already tracked in inventory" }, { status: 409 });
    }
    return NextResponse.json({ error: error?.message ?? "Couldn't create inventory item" }, { status: 500 });
  }

  if (opening > 0) {
    const { error: mvErr } = await svc.rpc("inventory_apply_movement", {
      p_product_id: productId,
      p_delta: opening,
      p_reason: "opening",
      p_ref_type: null,
      p_ref_id: null,
      p_job_id: null,
      p_staff_id: user.id,
      p_note: "Opening balance",
    });
    if (mvErr) {
      console.error("[inventory] opening balance failed:", mvErr.message);
      return NextResponse.json({ error: `Item created but opening balance failed: ${mvErr.message}` }, { status: 500 });
    }
  }

  await checkLowStock([productId]);
  return NextResponse.json({ ok: true, id: item.id });
}
