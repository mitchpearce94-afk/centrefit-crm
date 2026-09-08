import { NextRequest, NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { requireProductsManager, numberOrNull } from "@/lib/products/guard";

const TEXT_FIELDS = new Set([
  "name", "sku", "category", "subcategory", "device_type", "scope_role", "labour_code",
  "asset_type_id", "image_url", "description", "internal_notes",
]);
const BOOL_FIELDS = new Set(["requires_cable_run", "is_default", "is_active"]);

/**
 * Update a catalogue product. Whitelisted fields only. Cost is accepted here
 * only for direct-import (CentreFit) products where the form owns COGS; for
 * everyone else cost lives on the supplier offers.
 *
 * Lifecycle: `discontinued: true|false` sets/clears discontinued_at, and
 * `replacement_product_id` points the BOM engine at what to quote instead.
 */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const gate = await requireProductsManager();
  if (!gate.ok) return gate.response;

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
  for (const [k, v] of Object.entries(body)) {
    if (TEXT_FIELDS.has(k)) {
      if (v === null || v === undefined) update[k] = null;
      else if (typeof v === "string") update[k] = v.trim() === "" ? (k === "sku" ? "" : null) : v.trim();
      else return NextResponse.json({ error: `${k} must be a string` }, { status: 400 });
    } else if (BOOL_FIELDS.has(k)) {
      update[k] = Boolean(v);
    }
  }
  if (update.name === null) return NextResponse.json({ error: "Name can't be empty" }, { status: 400 });
  if (update.category === null) return NextResponse.json({ error: "Category can't be empty" }, { status: 400 });

  if (body.markup !== undefined) {
    const m = numberOrNull(body.markup);
    if (m == null || Number.isNaN(m) || m < 0) return NextResponse.json({ error: "Markup must be 0 or more" }, { status: 400 });
    update.markup = m;
  }
  if (body.cost_price !== undefined) {
    const c = numberOrNull(body.cost_price);
    if (c == null || Number.isNaN(c) || c < 0) return NextResponse.json({ error: "Cost must be 0 or more" }, { status: 400 });
    update.cost_price = c;
  }
  if (body.default_quantity !== undefined) {
    const q = numberOrNull(body.default_quantity);
    update.default_quantity = q == null || Number.isNaN(q) || q < 1 ? 1 : Math.floor(q);
  }

  const svc = createServiceRoleClient();

  // Lifecycle
  if (body.discontinued !== undefined) {
    if (body.discontinued) {
      const { data: cur } = await svc.from("quote_products").select("discontinued_at").eq("id", id).maybeSingle();
      update.discontinued_at = cur?.discontinued_at ?? new Date().toISOString();
    } else {
      update.discontinued_at = null;
    }
  }
  if (body.replacement_product_id !== undefined) {
    const rep = typeof body.replacement_product_id === "string" && body.replacement_product_id ? body.replacement_product_id : null;
    if (rep === id) return NextResponse.json({ error: "A product can't replace itself" }, { status: 400 });
    if (rep) {
      const { data: repRow } = await svc.from("quote_products").select("id, is_active, discontinued_at").eq("id", rep).maybeSingle();
      if (!repRow) return NextResponse.json({ error: "Replacement product not found" }, { status: 400 });
      if (!repRow.is_active) return NextResponse.json({ error: "Replacement product is inactive" }, { status: 400 });
      if (repRow.discontinued_at) return NextResponse.json({ error: "Replacement product is itself discontinued — point at its replacement instead" }, { status: 400 });
    }
    update.replacement_product_id = rep;
  }

  if (Object.keys(update).length === 1) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }

  const { data, error } = await svc
    .from("quote_products")
    .update(update)
    .eq("id", id)
    .select("id, sell_price, markup, cost_price, discontinued_at, replacement_product_id")
    .single();
  if (error || !data) return NextResponse.json({ error: error?.message ?? "Not found" }, { status: error ? 500 : 404 });
  return NextResponse.json({ ok: true, product: data });
}
