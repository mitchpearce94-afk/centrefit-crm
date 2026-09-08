import "server-only";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { enqueueNotification } from "@/lib/notifications/enqueue";

/**
 * Low-stock alerting (docs/inventory-CONTEXT.md D6).
 *
 * For every tracked item with a reorder point (optionally limited to a set of
 * products), compare on-hand to the point:
 *   - above the point  → clear low_stock_alerted_at so the next dip alerts again
 *   - at/below, not yet alerted → bell + email admins (and the item's
 *     nominated alert_staff_id if set), then stamp low_stock_alerted_at
 *   - at/below, already alerted → nothing (one alert per low episode)
 *
 * Called right after anything that moves stock, and swept daily by the
 * inventory-low-stock cron. Never throws — stock movements must not fail
 * because an email did.
 */
export async function checkLowStock(productIds?: string[]): Promise<{ checked: number; alerted: number }> {
  const svc = createServiceRoleClient();
  let query = svc
    .from("inventory_items")
    .select(
      "id, product_id, qty_on_hand, reorder_point, reorder_qty, location, alert_staff_id, low_stock_alerted_at, product:quote_products(name, sku)",
    )
    .not("reorder_point", "is", null);
  if (productIds && productIds.length > 0) query = query.in("product_id", productIds);

  const { data, error } = await query;
  if (error) {
    console.error("[inventory] low-stock check failed:", error.message);
    return { checked: 0, alerted: 0 };
  }

  let alerted = 0;
  for (const it of data ?? []) {
    const qty = Number(it.qty_on_hand);
    const point = Number(it.reorder_point);
    const product = Array.isArray(it.product) ? it.product[0] : it.product;
    const code = product?.sku || product?.name || "stock item";

    if (qty > point) {
      if (it.low_stock_alerted_at) {
        await svc.from("inventory_items").update({ low_stock_alerted_at: null }).eq("id", it.id);
      }
      continue;
    }
    if (it.low_stock_alerted_at) continue;

    const title = qty <= 0 ? `Out of stock — ${code}` : `Low stock — ${code}`;
    const body =
      `${qty} on hand · reorder at ${point}` +
      (it.reorder_qty ? ` · suggest ordering ${Number(it.reorder_qty)}` : "") +
      (it.location ? ` · ${it.location}` : "");
    const emailDetails = [
      { label: "Product", value: product ? `${product.sku ?? ""} ${product.name ?? ""}`.trim() : code },
      { label: "On hand", value: String(qty) },
      { label: "Reorder point", value: String(point) },
      ...(it.reorder_qty ? [{ label: "Suggested order qty", value: String(Number(it.reorder_qty)) }] : []),
      ...(it.location ? [{ label: "Location", value: it.location }] : []),
    ];
    const href = `/inventory?item=${it.id}`;

    try {
      await enqueueNotification({
        typeCode: "inventory.low_stock",
        refType: "inventory",
        refId: it.id,
        audience: { role: "admin" },
        title,
        body,
        href,
        emailDetails,
        ctaLabel: "Open inventory",
      });
      if (it.alert_staff_id) {
        // Nominated person on the item. Skip if they're an admin — they've
        // just been told via the role fan-out.
        const { data: st } = await svc.from("staff").select("role, is_active").eq("id", it.alert_staff_id).maybeSingle();
        if (st && st.is_active && st.role !== "admin") {
          await enqueueNotification({
            typeCode: "inventory.low_stock",
            refType: "inventory",
            refId: it.id,
            audience: { staffId: it.alert_staff_id },
            title,
            body,
            href,
            emailDetails,
            ctaLabel: "Open inventory",
          });
        }
      }
      await svc.from("inventory_items").update({ low_stock_alerted_at: new Date().toISOString() }).eq("id", it.id);
      alerted++;
    } catch (err) {
      console.error(`[inventory] low-stock alert failed for ${it.id}:`, err);
    }
  }
  return { checked: (data ?? []).length, alerted };
}
