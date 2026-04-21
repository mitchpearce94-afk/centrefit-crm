import { createClient } from "@/lib/supabase/server";
import { IntegrationsPanel } from "./integrations-panel";

export default async function IntegrationsPage({
  searchParams,
}: {
  searchParams: Promise<{ connected?: string; error?: string }>;
}) {
  const params = await searchParams;
  const supabase = await createClient();

  const { data: conn } = await supabase
    .from("xero_connections")
    .select("id, tenant_name, tenant_id, expires_at, last_sync_at, last_sync_result, created_at")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { count: productCount } = await supabase
    .from("quote_products")
    .select("id", { count: "exact", head: true })
    .eq("is_active", true);

  const { count: syncedCount } = await supabase
    .from("quote_products")
    .select("id", { count: "exact", head: true })
    .not("xero_item_id", "is", null);

  return (
    <div>
      <h1 className="text-2xl font-bold tracking-tight">Integrations</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Connect external systems to the CRM.
      </p>

      <div className="mt-6">
        <IntegrationsPanel
          connection={conn}
          productCount={productCount ?? 0}
          syncedCount={syncedCount ?? 0}
          initialFlash={
            params.connected
              ? { type: "success", message: "Connected to Xero." }
              : params.error
              ? { type: "error", message: params.error }
              : null
          }
        />
      </div>
    </div>
  );
}
