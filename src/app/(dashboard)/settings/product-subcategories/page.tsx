import { createClient } from "@/lib/supabase/server";
import { SubcategoriesAdmin, type ProductSubcategory } from "./subcategories-admin";

export default async function SettingsProductSubcategoriesPage() {
  const supabase = await createClient();

  const [subsRes, prodsRes] = await Promise.all([
    supabase
      .from("product_subcategories")
      .select("id, category, name, sort_order, is_active")
      .order("category")
      .order("sort_order"),
    supabase.from("quote_products").select("category").eq("is_active", true),
  ]);

  const subcategories = (subsRes.data ?? []) as ProductSubcategory[];

  // Drive the category groups off the live product catalogue so every
  // infrastructure that actually has products can be given sub-categories,
  // not just the seeded ones.
  const categorySet = new Set<string>();
  for (const r of (prodsRes.data ?? []) as { category: string | null }[]) {
    if (r.category) categorySet.add(r.category);
  }
  for (const s of subcategories) categorySet.add(s.category);
  const categories = Array.from(categorySet).sort((a, b) => a.localeCompare(b));

  return (
    <div>
      <h1 className="text-2xl font-bold tracking-tight">Product Sub-categories</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Group products within each infrastructure (e.g. Digital Surveillance →
        Cameras, NVRs, Hard Drives). These appear as the sub-category dropdown
        when adding a product and keep the catalogue tidy.
      </p>
      <div className="mt-5">
        <SubcategoriesAdmin subcategories={subcategories} categories={categories} />
      </div>
    </div>
  );
}
