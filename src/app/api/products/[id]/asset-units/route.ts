import { NextRequest, NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { requireProductsManager, numberOrNull } from "@/lib/products/guard";

/**
 * Asset register units: what ONE of this product puts on the site asset
 * register when it is received (lib/assets/product-units.ts). A kit lists
 * several (Veyla Protect kit → AI server + camera); a single device lists
 * one with its real make/model. Products with no rows fall back to their
 * asset-type tag.
 */
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: productId } = await params;
  const gate = await requireProductsManager();
  if (!gate.ok) return gate.response;

  let body: { id?: string; asset_type_id?: string; quantity?: number; device_name?: string | null; manufacturer?: string | null; model?: string | null; sort_order?: number };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const assetTypeId = (body.asset_type_id ?? "").trim();
  const qty = numberOrNull(body.quantity) ?? 1;
  if (!assetTypeId) return NextResponse.json({ error: "Pick an asset type" }, { status: 400 });
  if (!Number.isInteger(qty) || qty <= 0) return NextResponse.json({ error: "Quantity must be a whole number above 0" }, { status: 400 });

  const row = {
    product_id: productId,
    asset_type_id: assetTypeId,
    quantity: qty,
    device_name: (body.device_name ?? "").trim() || null,
    manufacturer: (body.manufacturer ?? "").trim() || null,
    model: (body.model ?? "").trim() || null,
    sort_order: numberOrNull(body.sort_order) ?? 100,
  };
  const svc = createServiceRoleClient();
  const q = body.id
    ? svc.from("product_asset_units").update(row).eq("id", body.id).eq("product_id", productId)
    : svc.from("product_asset_units").insert(row);
  const { data, error } = await q.select("id, product_id, asset_type_id, quantity, device_name, manufacturer, model, sort_order").single();
  if (error || !data) return NextResponse.json({ error: error?.message ?? "Save failed" }, { status: 500 });
  return NextResponse.json({ ok: true, unit: data });
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: productId } = await params;
  const gate = await requireProductsManager();
  if (!gate.ok) return gate.response;

  let body: { id?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const unitId = (body.id ?? "").trim();
  if (!unitId) return NextResponse.json({ error: "id is required" }, { status: 400 });

  const svc = createServiceRoleClient();
  const { error } = await svc.from("product_asset_units").delete().eq("id", unitId).eq("product_id", productId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
