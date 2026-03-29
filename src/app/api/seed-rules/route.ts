import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getSnapFitnessRules, getBasicRules } from "@/lib/quote-engine";
import type { DependencyRule } from "@/lib/quote-engine";

/**
 * POST /api/seed-rules
 * One-shot endpoint: loads products from DB, generates all rules from the
 * code-based engine, and inserts them into quote_dependency_rules.
 *
 * Safe to run multiple times — clears existing rules first.
 */
export async function POST() {
  const supabase = await createClient();

  // Load all active products
  const { data: products, error: prodErr } = await supabase
    .from("quote_products")
    .select("*")
    .eq("is_active", true);

  if (prodErr || !products) {
    return NextResponse.json({ error: "Failed to load products", detail: prodErr?.message }, { status: 500 });
  }

  // Generate rules from code
  const snapRules = getSnapFitnessRules(products);
  const basicRules = getBasicRules(products);
  const allRules = [...snapRules, ...basicRules];

  // Clear existing rules (fresh seed)
  const { error: deleteErr } = await supabase
    .from("quote_dependency_rules")
    .delete()
    .neq("id", "00000000-0000-0000-0000-000000000000"); // delete all

  if (deleteErr) {
    return NextResponse.json({ error: "Failed to clear existing rules", detail: deleteErr.message }, { status: 500 });
  }

  // Map DependencyRule objects to DB rows
  const rows = allRules.map((rule: DependencyRule, i: number) => ({
    preset: rule.preset,
    description: rule.description,
    is_active: rule.is_active,
    trigger_code: rule.trigger_code,
    trigger_condition: rule.trigger_condition,
    trigger_value: rule.trigger_value ?? null,
    trigger_min: rule.trigger_min ?? null,
    trigger_max: rule.trigger_max ?? null,
    trigger_site_field: rule.trigger_site_field ?? null,
    trigger_site_value: rule.trigger_site_value ?? null,
    trigger_site_op: rule.trigger_site_op ?? null,
    quantity_mode: rule.quantity_mode,
    quantity_value: rule.quantity_value ?? null,
    quantity_site_field: rule.quantity_site_field ?? null,
    quantity_multiplier: rule.quantity_multiplier ?? null,
    quantity_divisor: rule.quantity_divisor ?? null,
    quantity_formula: rule.quantity_formula ?? null,
    quantity_custom_key: rule.quantity_custom_key ?? null,
    auto_add_product_id: rule.auto_add_product_id ?? null,
    sort_order: i,
  }));

  // Insert in batches of 50
  let inserted = 0;
  let skipped = 0;
  for (let i = 0; i < rows.length; i += 50) {
    const batch = rows.slice(i, i + 50);
    // Filter out rows without a product ID (product wasn't found in catalog)
    const valid = batch.filter(r => r.auto_add_product_id);
    skipped += batch.length - valid.length;

    if (valid.length > 0) {
      const { error: insertErr } = await supabase
        .from("quote_dependency_rules")
        .insert(valid);

      if (insertErr) {
        return NextResponse.json({
          error: `Failed at batch ${i}`,
          detail: insertErr.message,
          inserted,
        }, { status: 500 });
      }
      inserted += valid.length;
    }
  }

  return NextResponse.json({
    success: true,
    total_generated: allRules.length,
    inserted,
    skipped_no_product: skipped,
    presets: {
      snap_fitness: snapRules.length,
      basic: basicRules.length,
    },
  });
}
