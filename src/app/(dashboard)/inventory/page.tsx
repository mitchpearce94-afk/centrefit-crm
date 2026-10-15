import { createClient } from "@/lib/supabase/server";
import { currentUserHasPermission } from "@/lib/auth/permissions";
import { InventoryManager, type InventoryItemRow, type JobOpt, type MovementRow, type ProductOpt, type StaffOpt } from "./inventory-manager";

export default async function InventoryPage({
  searchParams,
}: {
  searchParams: Promise<{ item?: string; q?: string }>;
}) {
  const supabase = await createClient();
  const params = await searchParams;

  // Jobs Sue can allocate stock to: anything not yet in a completion phase.
  const { data: completionStatuses } = await supabase.from("statuses").select("id").eq("phase", "completion");
  const completionIds = (completionStatuses ?? []).map((s) => s.id);
  let jobsQuery = supabase
    .from("jobs")
    .select("id, number, reference, customer:customers(name), site:customer_sites(name)")
    .order("number", { ascending: false })
    .limit(400);
  if (completionIds.length > 0) jobsQuery = jobsQuery.not("status_id", "in", `(${completionIds.join(",")})`);

  const [itemsRes, movesRes, productsRes, staffRes, canManage, jobsRes] = await Promise.all([
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
    jobsQuery,
  ]);

  const unwrap = <T,>(v: T | T[] | null | undefined): T | null => (Array.isArray(v) ? v[0] ?? null : v ?? null);

  const items = ((itemsRes.data ?? []) as Record<string, unknown>[]).map((r) => ({
    ...r,
    product: unwrap(r.product as InventoryItemRow["product"] | InventoryItemRow["product"][]),
    alert_staff: unwrap(r.alert_staff as { display_name: string } | { display_name: string }[] | null),
  })) as unknown as InventoryItemRow[];

  const jobs: JobOpt[] = ((jobsRes.data ?? []) as unknown as Array<{
    id: string; number: string | null; reference: string | null;
    customer: { name: string } | { name: string }[] | null;
    site: { name: string | null } | { name: string | null }[] | null;
  }>).map((j) => {
    const site = unwrap(j.site); const customer = unwrap(j.customer);
    return { id: j.id, number: j.number, label: [j.number, site?.name ?? customer?.name, j.reference].filter(Boolean).join(" · ") };
  });

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
      jobs={jobs}
      canManage={canManage}
      focusItemId={params.item ?? null}
      initialQuery={params.q ?? ""}
    />
  );
}
