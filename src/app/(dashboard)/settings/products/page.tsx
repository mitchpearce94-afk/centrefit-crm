import { createClient } from "@/lib/supabase/server";
import { ProductCatalog } from "./product-catalog";

export default async function SettingsProductsPage() {
  const supabase = await createClient();
  const [{ data: products }, { data: suppliers }] = await Promise.all([
    supabase.from("quote_products").select("*").order("category, name"),
    supabase.from("suppliers").select("id, name").eq("is_active", true).order("name"),
  ]);

  return (
    <div>
      <h1 className="text-2xl font-bold tracking-tight">Product Catalog</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Manage products, pricing, and default selections for quoting.
      </p>
      <div className="mt-5">
        <ProductCatalog products={products ?? []} suppliers={suppliers ?? []} />
      </div>
    </div>
  );
}
