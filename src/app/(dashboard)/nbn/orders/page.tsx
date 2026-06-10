import { createClient } from "@/lib/supabase/server";
import { OrdersTable, type NbnOrderRow } from "./orders-table";
import { OrderWizard } from "./order-wizard";

export const dynamic = "force-dynamic";

export default async function NbnOrdersPage() {
  const supabase = await createClient();
  const { data: orders } = await supabase
    .from("nbn_orders")
    .select("id, nbn_order_id, order_reference, formatted_address, product_class, bandwidth_sku, state, sub_state, testing_mode, created_at, last_synced_at")
    .order("created_at", { ascending: false })
    .limit(100);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-sm font-semibold">NBN orders</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Lodge and track NBN connect orders directly with Kinetix — no Rev3 portal required.
          New orders default to <span className="font-medium text-amber-400">Testing Mode</span> (simulated, nothing reaches NBN).
        </p>
      </div>

      <OrderWizard />
      <OrdersTable orders={(orders ?? []) as NbnOrderRow[]} />
    </div>
  );
}
