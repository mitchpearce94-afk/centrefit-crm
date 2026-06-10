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
    try {
      await client.accountingApi.updateItem(tenantId, product.xero_item_id, { items: [item] });
      return product.xero_item_id;
    } catch {
      // Stale ID — the item was deleted or merged in Xero after we stored it.
      // Fall through to create-or-adopt below rather than failing the line.
    }
  }

  try {
    // summarizeErrors=true so validation failures THROW instead of coming back
    // as a 200 with hasValidationErrors — otherwise a duplicate code returns
    // no ItemID and the product silently never syncs.
    const res = await client.accountingApi.createItems(tenantId, { items: [item] }, true);
    const created = res.body.items?.[0]?.itemID;
    if (created) return created;
    throw new Error("Xero accepted the item but returned no ItemID");
  } catch (createErr: unknown) {
    // Whatever the create failure was, an item with this Code may already
    // exist in Xero (e.g. made by hand — Xero's message is "Code must be
    // unique", NOT "already exists", which the old check missed). Adopt it.
    const existing = await client.accountingApi.getItems(
      tenantId,
      undefined,
      `Code=="${(item.code ?? "").replace(/"/g, '\\"')}"`,
    );
    const found = existing.body.items?.[0];
    if (!found?.itemID) throw new Error(xeroErrorMessage(createErr));
    await client.accountingApi.updateItem(tenantId, found.itemID, { items: [item] });
    return found.itemID;
  }
}

/**
 * xero-node failures stringify to useless generic text ("Request failed…").
 * Dig the actual validation messages out of the response body so the PO
 * generation warning tells staff what to fix instead of "see console".
 */
export function xeroErrorMessage(err: unknown): string {
  try {
    const anyErr = err as { response?: { body?: unknown }; body?: unknown };
    const body = (anyErr.response?.body ?? anyErr.body) as {
      Elements?: { ValidationErrors?: { Message?: string }[] }[];
      elements?: { validationErrors?: { message?: string }[] }[];
      Message?: string;
    } | undefined;
    const element = body?.Elements?.[0] ?? body?.elements?.[0];
    const validation = (element as { ValidationErrors?: { Message?: string }[] })?.ValidationErrors
      ?? (element as { validationErrors?: { message?: string }[] })?.validationErrors;
    const messages = (validation ?? [])
      .map((v) => (v as { Message?: string; message?: string }).Message ?? (v as { message?: string }).message)
      .filter((m): m is string => !!m);
    if (messages.length) return messages.join("; ");
    if (typeof body?.Message === "string") return body.Message;
  } catch {
    // fall through to the generic message
  }
  return err instanceof Error ? err.message : String(err);
}
