import { createClient } from "@/lib/supabase/server";
import { ProductCatalog } from "./product-catalog";
import { SyncToXeroButton } from "./sync-to-xero-button";

export default async function SettingsProductsPage() {
  const supabase = await createClient();
  const [{ data: products }, { data: suppliers }, { data: scopeRoles }, { data: labourTimings }, { data: xeroConn }] =
    await Promise.all([
      supabase.from("quote_products").select("*").order("category, name"),
      supabase.from("suppliers").select("id, name").eq("is_active", true).order("name"),
      supabase.from("quote_scope_roles").select("slug, label").order("label"),
      supabase.from("labour_timings").select("code, name").order("name"),
      supabase
        .from("xero_connections")
        .select("id, tenant_name, last_sync_at")
        .limit(1)
        .maybeSingle(),
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
        <ProductCatalog products={products ?? []} suppliers={suppliers ?? []} scopeRoles={scopeRoles ?? []} labourTimings={labourTimings ?? []} />
      </div>
    </div>
  );
}
