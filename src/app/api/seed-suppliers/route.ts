import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * POST /api/seed-suppliers
 * Extracts unique supplier names from quote_products,
 * creates them in the suppliers table (if not already there),
 * then backfills supplier_id FK on quote_products.
 */
export async function POST() {
  const supabase = await createClient();

  // Get all unique supplier names from products
  const { data: products, error: prodErr } = await supabase
    .from("quote_products")
    .select("id, supplier, supplier_id")
    .order("supplier");

  if (prodErr || !products) {
    return NextResponse.json({ error: "Failed to load products", detail: prodErr?.message }, { status: 500 });
  }

  // Extract unique supplier names (skip empty/null)
  const uniqueNames = [...new Set(
    products
      .map(p => p.supplier?.trim())
      .filter((s): s is string => !!s && s.length > 0)
  )];

  // Get existing suppliers
  const { data: existingSuppliers } = await supabase
    .from("suppliers")
    .select("id, name");

  const existingMap = new Map(
    (existingSuppliers ?? []).map(s => [s.name.toLowerCase().trim(), s.id])
  );

  // Insert missing suppliers
  const toInsert = uniqueNames.filter(
    name => !existingMap.has(name.toLowerCase().trim())
  );

  let created = 0;
  if (toInsert.length > 0) {
    const { data: newSuppliers, error: insertErr } = await supabase
      .from("suppliers")
      .insert(toInsert.map(name => ({
        name,
        is_active: true,
      })))
      .select("id, name");

    if (insertErr) {
      return NextResponse.json({ error: "Failed to insert suppliers", detail: insertErr.message }, { status: 500 });
    }

    created = newSuppliers?.length ?? 0;

    // Add new ones to the map
    for (const s of newSuppliers ?? []) {
      existingMap.set(s.name.toLowerCase().trim(), s.id);
    }
  }

  // Backfill supplier_id on all products that don't have one
  let linked = 0;
  for (const product of products) {
    if (product.supplier_id) continue; // already linked
    const supplierName = product.supplier?.trim();
    if (!supplierName) continue;

    const supplierId = existingMap.get(supplierName.toLowerCase().trim());
    if (!supplierId) continue;

    const { error } = await supabase
      .from("quote_products")
      .update({ supplier_id: supplierId })
      .eq("id", product.id);

    if (!error) linked++;
  }

  return NextResponse.json({
    success: true,
    unique_supplier_names: uniqueNames.length,
    already_existed: uniqueNames.length - toInsert.length,
    created,
    products_linked: linked,
  });
}
