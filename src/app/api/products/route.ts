import { NextRequest, NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { requireProductsManager, numberOrNull } from "@/lib/products/guard";

/**
 * Create a catalogue product. The initial supplier becomes the preferred
 * pricing offer (products-CONTEXT.md D11) via the product→offer trigger; the
 * supplier's own SKU/item name are patched onto that offer afterwards.
 */
export async function POST(req: NextRequest) {
  const gate = await requireProductsManager();
  if (!gate.ok) return gate.response;

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const name = String(body.name ?? "").trim();
  const category = String(body.category ?? "").trim();
  const supplierId = String(body.supplier_id ?? "").trim();
  const cost = numberOrNull(body.cost_price);
  const markup = numberOrNull(body.markup);
  if (!name) return NextResponse.json({ error: "Name is required" }, { status: 400 });
  if (!category) return NextResponse.json({ error: "Category is required" }, { status: 400 });
  if (!supplierId) return NextResponse.json({ error: "Supplier is required — it becomes the preferred pricing offer" }, { status: 400 });
  if (cost == null || Number.isNaN(cost) || cost < 0) return NextResponse.json({ error: "Cost price must be 0 or more" }, { status: 400 });
  if (markup == null || Number.isNaN(markup) || markup < 0) return NextResponse.json({ error: "Markup must be 0 or more" }, { status: 400 });
  const defaultQty = Math.max(1, Math.floor(numberOrNull(body.default_quantity) ?? 1) || 1);

  const svc = createServiceRoleClient();
  const { data: created, error } = await svc
    .from("quote_products")
    .insert({
      name,
      sku: typeof body.sku === "string" && body.sku.trim() ? body.sku.trim() : null,
      category,
      subcategory: typeof body.subcategory === "string" && body.subcategory ? body.subcategory : null,
      supplier_id: supplierId,
      cost_price: cost,
      markup,
      device_type: typeof body.device_type === "string" && body.device_type ? body.device_type : null,
      scope_role: typeof body.scope_role === "string" && body.scope_role ? body.scope_role : null,
      labour_code: typeof body.labour_code === "string" && body.labour_code ? body.labour_code : null,
      asset_type_id: typeof body.asset_type_id === "string" && body.asset_type_id ? body.asset_type_id : null,
      image_url: typeof body.image_url === "string" && body.image_url ? body.image_url : null,
      requires_cable_run: Boolean(body.requires_cable_run),
      description: typeof body.description === "string" && body.description.trim() ? body.description.trim() : null,
      default_quantity: defaultQty,
      internal_notes: typeof body.internal_notes === "string" && body.internal_notes.trim() ? body.internal_notes.trim() : null,
      is_default: Boolean(body.is_default),
      is_active: true,
    })
    .select("id")
    .single();
  if (error || !created) {
    return NextResponse.json({ error: error?.message ?? "Insert failed" }, { status: 500 });
  }

  const refSku = typeof body.supplier_ref_sku === "string" ? body.supplier_ref_sku.trim() : "";
  const refName = typeof body.supplier_ref_name === "string" ? body.supplier_ref_name.trim() : "";
  let offerWarning: string | null = null;
  if (refSku || refName) {
    const { error: offerErr } = await svc
      .from("product_supplier_offers")
      .update({ supplier_sku: refSku || null, supplier_item_name: refName || null })
      .eq("product_id", created.id)
      .eq("supplier_id", supplierId);
    if (offerErr) offerWarning = `Product added, but saving the supplier's SKU failed: ${offerErr.message}`;
  }

  return NextResponse.json({ ok: true, id: created.id, warning: offerWarning });
}
