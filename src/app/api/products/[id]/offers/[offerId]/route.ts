import { NextRequest, NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { requireProductsManager, numberOrNull } from "@/lib/products/guard";

/**
 * Edit one supplier offer.
 *
 * `make_preferred: true` flips the star. By default (`keep_sell` true) the
 * flip is MARGIN-PRESERVING: markup is re-pinned so the customer sell price
 * stays where it was and only COGS changes (Mitchell's rule, 2026-07-08 —
 * a naive flip used to silently reprice quotes because sell is a generated
 * column). Pass keep_sell:false to let the sell follow the existing markup.
 *
 * A cost edit on the current preferred offer still flows through the trigger
 * onto the product with markup unchanged (a supplier price rise passes
 * through); the response reports sell before/after so the UI can say so.
 */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string; offerId: string }> }) {
  const { id: productId, offerId } = await params;
  const gate = await requireProductsManager();
  if (!gate.ok) return gate.response;

  let body: {
    supplier_id?: string;
    supplier_sku?: string | null;
    supplier_item_name?: string | null;
    cost_price?: number;
    make_preferred?: boolean;
    keep_sell?: boolean;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const svc = createServiceRoleClient();
  const { data: offer, error: offErr } = await svc
    .from("product_supplier_offers")
    .select("id, product_id, supplier_id, cost_price, is_preferred")
    .eq("id", offerId)
    .eq("product_id", productId)
    .maybeSingle();
  if (offErr) return NextResponse.json({ error: offErr.message }, { status: 500 });
  if (!offer) return NextResponse.json({ error: "Offer not found" }, { status: 404 });

  const { data: before } = await svc.from("quote_products").select("sell_price, markup, cost_price").eq("id", productId).maybeSingle();

  // 1. Field edits (sku / name / supplier / cost)
  const update: Record<string, unknown> = {};
  if (body.supplier_id !== undefined) {
    const sid = (body.supplier_id ?? "").trim();
    if (!sid) return NextResponse.json({ error: "Pick a supplier" }, { status: 400 });
    update.supplier_id = sid;
  }
  if (body.supplier_sku !== undefined) update.supplier_sku = body.supplier_sku?.trim() || null;
  if (body.supplier_item_name !== undefined) update.supplier_item_name = body.supplier_item_name?.trim() || null;
  if (body.cost_price !== undefined) {
    const c = numberOrNull(body.cost_price);
    if (c == null || Number.isNaN(c) || c < 0) return NextResponse.json({ error: "Invalid cost" }, { status: 400 });
    if (Math.abs(c - Number(offer.cost_price)) > 0.0001) {
      update.cost_price = c;
      update.cost_updated_at = new Date().toISOString();
    }
  }
  if (Object.keys(update).length > 0) {
    update.updated_at = new Date().toISOString();
    const { error } = await svc.from("product_supplier_offers").update(update).eq("id", offerId);
    if (error) {
      if (error.code === "23505") return NextResponse.json({ error: "That supplier already has an offer on this product" }, { status: 409 });
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
  }

  // 2. Preferred flip
  let flip: { sell_before: number; sell_after: number; markup: number; cost: number } | null = null;
  if (body.make_preferred && !offer.is_preferred) {
    const { data, error } = await svc.rpc("product_set_preferred_offer", {
      p_offer_id: offerId,
      p_keep_sell: body.keep_sell !== false,
    });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    flip = data as typeof flip;
  }

  const { data: after } = await svc.from("quote_products").select("sell_price, markup, cost_price").eq("id", productId).maybeSingle();
  return NextResponse.json({
    ok: true,
    flip,
    product_before: before,
    product_after: after,
  });
}

/** Remove an offer. The preferred one can't go — star another first. */
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string; offerId: string }> }) {
  const { id: productId, offerId } = await params;
  const gate = await requireProductsManager();
  if (!gate.ok) return gate.response;

  const svc = createServiceRoleClient();
  const { data: offer } = await svc
    .from("product_supplier_offers")
    .select("id, is_preferred")
    .eq("id", offerId)
    .eq("product_id", productId)
    .maybeSingle();
  if (!offer) return NextResponse.json({ error: "Offer not found" }, { status: 404 });
  if (offer.is_preferred) return NextResponse.json({ error: "Make another offer preferred first" }, { status: 400 });

  const { error } = await svc.from("product_supplier_offers").delete().eq("id", offerId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
