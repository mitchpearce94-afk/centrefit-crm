import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { currentUserHasPermission } from "@/lib/auth/permissions";
import { checkLowStock } from "@/lib/inventory/low-stock";

async function guard() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: NextResponse.json({ error: "Not authenticated" }, { status: 401 }) };
  if (!(await currentUserHasPermission("inventory.manage"))) {
    return { error: NextResponse.json({ error: "You don't have permission to manage inventory" }, { status: 403 }) };
  }
  return { user };
}

/**
 * Edit the settings on a tracked item: reorder point / qty, location, notes,
 * nominated alert person. Quantity is NOT patchable here — stock only moves
 * through the ledger (/adjust) so every change has a reason and an author.
 */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const g = await guard();
  if ("error" in g) return g.error;

  let body: {
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

  const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (body.reorder_point !== undefined) {
    const v = body.reorder_point == null || body.reorder_point === ("" as unknown) ? null : Number(body.reorder_point);
    if (v != null && (!Number.isFinite(v) || v < 0)) return NextResponse.json({ error: "Reorder point must be 0 or more" }, { status: 400 });
    update.reorder_point = v;
  }
  if (body.reorder_qty !== undefined) {
    const v = body.reorder_qty == null || body.reorder_qty === ("" as unknown) ? null : Number(body.reorder_qty);
    if (v != null && (!Number.isFinite(v) || v <= 0)) return NextResponse.json({ error: "Reorder quantity must be greater than 0" }, { status: 400 });
    update.reorder_qty = v;
  }
  if (body.location !== undefined) update.location = body.location?.trim() || null;
  if (body.notes !== undefined) update.notes = body.notes?.trim() || null;
  if (body.alert_staff_id !== undefined) update.alert_staff_id = body.alert_staff_id || null;

  const svc = createServiceRoleClient();
  const { data: item, error } = await svc
    .from("inventory_items")
    .update(update)
    .eq("id", id)
    .select("id, product_id")
    .single();
  if (error || !item) return NextResponse.json({ error: error?.message ?? "Not found" }, { status: error ? 500 : 404 });

  // A lowered threshold may already be crossed; a raised one may clear the
  // current alert. checkLowStock handles both directions.
  await checkLowStock([item.product_id]);
  return NextResponse.json({ ok: true });
}

/** Stop tracking. Movements cascade — the history goes with it. */
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const g = await guard();
  if ("error" in g) return g.error;

  const svc = createServiceRoleClient();
  const { error } = await svc.from("inventory_items").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
