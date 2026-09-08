import { NextRequest, NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { requireProductsManager, numberOrNull } from "@/lib/products/guard";

/** Add a supplier offer (never preferred on create — star it explicitly). */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: productId } = await params;
  const gate = await requireProductsManager();
  if (!gate.ok) return gate.response;

  let body: { supplier_id?: string; supplier_sku?: string | null; supplier_item_name?: string | null; cost_price?: number };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const supplierId = (body.supplier_id ?? "").trim();
  const cost = numberOrNull(body.cost_price);
  if (!supplierId) return NextResponse.json({ error: "Pick a supplier" }, { status: 400 });
  if (cost == null || Number.isNaN(cost) || cost < 0) return NextResponse.json({ error: "Invalid cost" }, { status: 400 });

  const svc = createServiceRoleClient();
  const { data, error } = await svc
    .from("product_supplier_offers")
    .insert({
      product_id: productId,
      supplier_id: supplierId,
      supplier_sku: body.supplier_sku?.trim() || null,
      supplier_item_name: body.supplier_item_name?.trim() || null,
      cost_price: cost,
      cost_updated_at: new Date().toISOString(),
      is_preferred: false,
    })
    .select("id")
    .single();
  if (error || !data) {
    if (error?.code === "23505") return NextResponse.json({ error: "That supplier already has an offer on this product" }, { status: 409 });
    return NextResponse.json({ error: error?.message ?? "Insert failed" }, { status: 500 });
  }
  return NextResponse.json({ ok: true, id: data.id });
}
