import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * What a catalogue product puts on the site asset register, per unit ordered.
 *
 * Two sources, in priority order:
 *   1. product_asset_units — explicit rows for products that yield several
 *      trackable things (Veyla Protect kit = AI server + camera) or need their
 *      own make/model (Veyla Access Controller = HID Aero X1100).
 *   2. quote_products.asset_type_id — the legacy one-product-one-asset tag.
 *      Only TRACKABLE types (serial / MAC / IP / Wi-Fi / RFID) count; cable
 *      and mounts stay off the register.
 *
 * Used by the BOM→assets import (shells before install) and by procurement
 * Receive (serials as the boxes come in). Mitchell 2026-10-19.
 */
export interface AssetUnitTemplate {
  assetTypeId: string;
  assetTypeName: string;
  deviceName: string;
  manufacturer: string | null;
  model: string | null;
  hasSerial: boolean;
  hasMac: boolean;
  hasIp: boolean;
  /** Units of this template per ONE unit of the product. */
  quantity: number;
  /** true when the template came from product_asset_units (explicit). */
  explicit: boolean;
}

interface AssetTypeRow {
  id: string;
  name: string | null;
  default_manufacturer: string | null;
  default_model: string | null;
  has_serial: boolean;
  has_mac: boolean;
  has_ip: boolean;
  has_wifi: boolean;
  has_rfid: boolean;
}

export function isTrackable(t: Pick<AssetTypeRow, "has_serial" | "has_mac" | "has_ip" | "has_wifi" | "has_rfid">): boolean {
  return !!(t.has_serial || t.has_mac || t.has_ip || t.has_wifi || t.has_rfid);
}

/**
 * Resolve the asset unit templates for a set of products. Products that yield
 * nothing trackable are absent from the map.
 */
export async function assetUnitsForProducts(
  supabase: SupabaseClient,
  productIds: string[],
): Promise<Map<string, AssetUnitTemplate[]>> {
  const out = new Map<string, AssetUnitTemplate[]>();
  const ids = Array.from(new Set(productIds.filter(Boolean)));
  if (ids.length === 0) return out;

  const [{ data: units }, { data: products }, { data: types }] = await Promise.all([
    supabase
      .from("product_asset_units")
      .select("product_id, asset_type_id, quantity, device_name, manufacturer, model, sort_order")
      .in("product_id", ids)
      .order("sort_order", { ascending: true }),
    supabase.from("quote_products").select("id, name, sku, asset_type_id").in("id", ids),
    supabase
      .from("asset_types")
      .select("id, name, default_manufacturer, default_model, has_serial, has_mac, has_ip, has_wifi, has_rfid")
      .eq("is_active", true),
  ]);
  const typeById = new Map<string, AssetTypeRow>((types ?? []).map((t) => [t.id as string, t as AssetTypeRow]));

  for (const u of units ?? []) {
    const t = typeById.get(u.asset_type_id as string);
    if (!t || !isTrackable(t)) continue;
    const list = out.get(u.product_id as string) ?? [];
    list.push({
      assetTypeId: t.id,
      assetTypeName: (t.name ?? "").trim() || "Asset",
      deviceName: (u.device_name ?? "").trim() || (t.name ?? "").trim() || "Asset",
      manufacturer: (u.manufacturer ?? "").trim() || t.default_manufacturer || null,
      model: (u.model ?? "").trim() || t.default_model || null,
      hasSerial: !!t.has_serial,
      hasMac: !!t.has_mac,
      hasIp: !!t.has_ip,
      quantity: Math.max(1, Math.round(Number(u.quantity) || 1)),
      explicit: true,
    });
    out.set(u.product_id as string, list);
  }

  for (const p of products ?? []) {
    if (out.has(p.id as string)) continue; // explicit rows win
    const t = p.asset_type_id ? typeById.get(p.asset_type_id as string) : null;
    if (!t || !isTrackable(t)) continue;
    out.set(p.id as string, [
      {
        assetTypeId: t.id,
        assetTypeName: (t.name ?? "").trim() || "Asset",
        deviceName: (p.name ?? "").trim() || (t.name ?? "").trim() || "Asset",
        manufacturer: t.default_manufacturer || null,
        model: t.default_model || ((p.sku ?? "") as string).trim() || null,
        hasSerial: !!t.has_serial,
        hasMac: !!t.has_mac,
        hasIp: !!t.has_ip,
        quantity: 1,
        explicit: false,
      },
    ]);
  }
  return out;
}

/** One entry per physical unit: templates × product quantity. */
export function expandUnits(templates: AssetUnitTemplate[], productQty: number): AssetUnitTemplate[] {
  const n = Math.max(1, Math.round(Number(productQty) || 1));
  const rows: AssetUnitTemplate[] = [];
  for (let i = 0; i < n; i++) {
    for (const t of templates) {
      for (let k = 0; k < t.quantity; k++) rows.push({ ...t, quantity: 1 });
    }
  }
  return rows;
}
