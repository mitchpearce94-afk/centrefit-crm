import { createClient } from "@/lib/supabase/server";
import { ProductCatalog } from "./product-catalog";
import { SyncToXeroButton } from "./sync-to-xero-button";

export default async function SettingsProductsPage() {
  const supabase = await createClient();
  const [{ data: products }, { data: suppliers }, { data: scopeRoles }, { data: labourTimings }, { data: assetTypes }, { data: subcategories }, { data: xeroConn }, { data: offers }] =
    await Promise.all([
      supabase.from("quote_products").select("*").order("category, name"),
      supabase.from("suppliers").select("id, name").eq("is_active", true).order("name"),
      supabase.from("quote_scope_roles").select("slug, label").order("label"),
      supabase.from("labour_timings").select("code, name").order("name"),
      supabase
        .from("asset_types")
        .select("id, name, category, has_serial, has_mac, has_ip, has_wifi, has_rfid")
        .eq("is_active", true)
        .order("category")
        .order("name"),
      supabase
        .from("product_subcategories")
        .select("id, category, name, sort_order, is_active")
        .order("category")
        .order("sort_order"),
      supabase
        .from("xero_connections")
        .select("id, tenant_name, last_sync_at")
        .limit(1)
        .maybeSingle(),
      supabase
        .from("product_supplier_offers")
        .select("id, product_id, supplier_id, supplier_sku, supplier_item_name, cost_price, cost_updated_at, is_preferred")
        .order("is_preferred", { ascending: false })
        .order("cost_price", { ascending: true }),
    ]);

  return (
    <div>
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Product Catalog</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Manage products, pricing, and default selections for quoting.
          </p>
        </div>
        <SyncToXeroButton connected={!!xeroConn} tenantName={xeroConn?.tenant_name ?? null} />
      </div>
      <div className="mt-5">
        <ProductCatalog products={products ?? []} suppliers={suppliers ?? []} scopeRoles={scopeRoles ?? []} labourTimings={labourTimings ?? []} assetTypes={assetTypes ?? []} subcategories={subcategories ?? []} offers={offers ?? []} />
      </div>
    </div>
  );
}
