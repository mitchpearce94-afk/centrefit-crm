import { createClient } from "@/lib/supabase/server";
import { currentUserHasPermission } from "@/lib/auth/permissions";
import { InventoryManager, type InventoryItemRow, type MovementRow, type ProductOpt, type StaffOpt } from "./inventory-manager";

export default async function InventoryPage({
  searchParams,
}: {
  searchParams: Promise<{ item?: string; q?: string }>;
}) {
  const supabase = await createClient();
  const params = await searchParams;

  const [itemsRes, movesRes, productsRes, staffRes, canManage] = await Promise.all([
    supabase
      .from("inventory_items")
      .select("*, product:quote_products(id, name, sku, category, image_url), alert_staff:staff!inventory_items_alert_staff_id_fkey(display_name)")
      .order("updated_at", { ascending: false }),
    supabase
      .from("inventory_movements")
      .select("id, inventory_item_id, delta, qty_after, reason, job_id, note, created_at, staff:staff(display_name, initials), job:jobs(number)")
      .order("created_at", { ascending: false })
      .limit(400),
    supabase
      .from("quote_products")
      .select("id, name, sku, category, image_url")
      .eq("is_active", true)
      .order("category, name"),
    supabase.from("staff").select("id, display_name").eq("is_active", true).order("display_name"),
    currentUserHasPermission("inventory.manage"),
  ]);

  const unwrap = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? v[0] ?? null : v ?? null);

  const items = ((itemsRes.data ?? []) as Record<string, unknown>[]).map((r) => ({
    ...r,
    product: unwrap(r.product as InventoryItemRow["product"] | InventoryItemRow["product"][]),
    alert_staff: unwrap(r.alert_staff as { display_name: string } | { display_name: string }[] | null),
  })) as unknown as InventoryItemRow[];

  const movements = ((movesRes.data ?? []) as Record<string, unknown>[]).map((r) => ({
    ...r,
    staff: unwrap(r.staff as MovementRow["staff"] | MovementRow["staff"][]),
    job: unwrap(r.job as MovementRow["job"] | MovementRow["job"][]),
  })) as unknown as MovementRow[];

  return (
    <InventoryManager
      items={items}
      movements={movements}
      products={(productsRes.data ?? []) as ProductOpt[]}
      staff={(staffRes.data ?? []) as StaffOpt[]}
      canManage={canManage}
      focusItemId={params.item ?? null}
      initialQuery={params.q ?? ""}
    />
  );
}
