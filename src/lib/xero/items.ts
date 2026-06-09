import type { XeroClient, Item } from "xero-node";

export interface SyncableProduct {
  id: string;
  name: string;
  sku: string | null;
  category: string | null;
  supplier: string | null;
  cost_price: number | null;
  sell_price: number | null;
  xero_item_id: string | null;
}

/**
 * Create-or-update a quote_product as a Xero Item, returning its Xero ItemID.
 *
 * - `sku` → Xero `code` (the unique key). Products with no SKU can't be Items,
 *   so this returns null for them (caller falls back to a description-only line).
 * - `cost_price` → `purchaseDetails.unitPrice` — refreshed on every call so the
 *   Xero Item master never drifts behind the catalogue price.
 * - If `xero_item_id` is set, PUT update. Else CREATE, and if Xero says the Code
 *   already exists (e.g. an item made by hand in Xero), look it up by Code and
 *   UPDATE so we adopt it instead of erroring.
 *
 * Mirrors the bulk Settings → Products sync (api/xero/sync-products) so the two
 * paths produce identical Items.
 */
export async function ensureXeroItem(
  client: XeroClient,
  tenantId: string,
  product: SyncableProduct,
): Promise<string | null> {
  if (!product.sku || product.sku.trim() === "") return null;

  const item: Item = {
    code: product.sku.slice(0, 30),
    name: (product.name || product.sku).slice(0, 50),
    description: product.category
      ? `${product.category}${product.supplier ? ` — ${product.supplier}` : ""}`
      : product.supplier ?? undefined,
    purchaseDescription: product.supplier ?? undefined,
    isSold: true,
    isPurchased: true,
    isTrackedAsInventory: false,
    purchaseDetails: { unitPrice: Number(product.cost_price) || 0 },
    salesDetails: { unitPrice: Number(product.sell_price) || 0 },
  };

  if (product.xero_item_id) {
    await client.accountingApi.updateItem(tenantId, product.xero_item_id, { items: [item] });
    return product.xero_item_id;
  }

  try {
    const res = await client.accountingApi.createItems(tenantId, { items: [item] });
    return res.body.items?.[0]?.itemID ?? null;
  } catch (createErr: unknown) {
    const isDuplicate =
      createErr &&
      typeof createErr === "object" &&
      "response" in createErr &&
      JSON.stringify(createErr).toLowerCase().includes("already");
    if (!isDuplicate) throw createErr;

    const existing = await client.accountingApi.getItems(
      tenantId,
      undefined,
      `Code=="${item.code}"`,
    );
    const found = existing.body.items?.[0];
    if (!found?.itemID) throw createErr;
    await client.accountingApi.updateItem(tenantId, found.itemID, { items: [item] });
    return found.itemID;
  }
}
