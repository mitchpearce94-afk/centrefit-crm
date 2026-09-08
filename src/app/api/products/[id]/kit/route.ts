import { NextRequest, NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { requireProductsManager, numberOrNull } from "@/lib/products/guard";

/**
 * Kit contents: "this product ships with N × component". generateBOM() nets
 * these off any rule- or device-added lines so the kit never double-counts
 * what's already in the box (the MW730B-in-the-K6000-kit problem).
 */
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: kitId } = await params;
  const gate = await requireProductsManager();
  if (!gate.ok) return gate.response;

  let body: { component_product_id?: string; quantity?: number };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const componentId = (body.component_product_id ?? "").trim();
  const qty = numberOrNull(body.quantity) ?? 1;
  if (!componentId) return NextResponse.json({ error: "Pick a component product" }, { status: 400 });
  if (componentId === kitId) return NextResponse.json({ error: "A kit can't contain itself" }, { status: 400 });
  if (Number.isNaN(qty) || qty <= 0) return NextResponse.json({ error: "Quantity must be greater than 0" }, { status: 400 });

  const svc = createServiceRoleClient();
  const { data, error } = await svc
    .from("quote_product_kit_contents")
    .upsert(
      { kit_product_id: kitId, component_product_id: componentId, quantity: qty },
      { onConflict: "kit_product_id,component_product_id" },
    )
    .select("id, kit_product_id, component_product_id, quantity")
    .single();
  if (error || !data) return NextResponse.json({ error: error?.message ?? "Save failed" }, { status: 500 });
  return NextResponse.json({ ok: true, content: data });
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: kitId } = await params;
  const gate = await requireProductsManager();
  if (!gate.ok) return gate.response;

  let body: { component_product_id?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const componentId = (body.component_product_id ?? "").trim();
  if (!componentId) return NextResponse.json({ error: "component_product_id is required" }, { status: 400 });

  const svc = createServiceRoleClient();
  const { error } = await svc
    .from("quote_product_kit_contents")
    .delete()
    .eq("kit_product_id", kitId)
    .eq("component_product_id", componentId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
