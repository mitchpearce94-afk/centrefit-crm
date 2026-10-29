import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { isCurrentUserAdmin } from "@/lib/auth/current-staff";
import { IntegrationsPanel } from "./integrations-panel";

export default async function IntegrationsPage({
  searchParams,
}: {
  searchParams: Promise<{ connected?: string; error?: string }>;
}) {
  const params = await searchParams;
  const supabase = await createClient();
  const canManage = await isCurrentUserAdmin();

  // xero_connections is admin-only under RLS, so a non-admin would see
  // "Not connected" (and a Connect button whose callback then fails on the
  // insert policy). Read the status columns via the service role — no tokens
  // are selected here — and let the panel hide the manage buttons instead.
  const { data: conn } = await createServiceRoleClient()
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
          canManage={canManage}
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
