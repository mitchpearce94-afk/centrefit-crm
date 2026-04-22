import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getAuthedClient } from "@/lib/xero/client";

// Dry-run report for syncing CRM products to Xero Items.
// Returns what WOULD happen without touching Xero. Safe to call any time.
//
// Query params:
//   productIds=comma,separated,uuids — scope the preview to specific CRM rows
//   (unset = all active + inactive products)

type Collision = {
  productId: string;
  sku: string;
  crmName: string;
  xeroName: string | null;
  xeroItemId: string | null;
  changes: {
    field: string;
    from: string | number | null;
    to: string | number | null;
  }[];
};

type NewItem = {
  productId: string;
  sku: string;
  name: string;
  sellPrice: number;
  costPrice: number;
};

type LinkedUpdate = {
  productId: string;
  sku: string;
  xeroItemId: string;
  crmName: string;
};

export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  let client: Awaited<ReturnType<typeof getAuthedClient>>["client"];
  let conn: Awaited<ReturnType<typeof getAuthedClient>>["conn"];
  try {
    ({ client, conn } = await getAuthedClient());
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: `Xero not connected: ${msg}` }, { status: 400 });
  }

  const productIdsParam = req.nextUrl.searchParams.get("productIds");
  const productIds = productIdsParam
    ? productIdsParam.split(",").map((s) => s.trim()).filter(Boolean)
    : null;

  let query = supabase
    .from("quote_products")
    .select("id, name, sku, category, supplier, cost_price, sell_price, xero_item_id");
  if (productIds && productIds.length > 0) {
    query = query.in("id", productIds);
  }
  const { data: products, error: prodErr } = await query;
  if (prodErr) {
    return NextResponse.json({ error: prodErr.message }, { status: 500 });
  }

  // Fetch all Xero items once. Xero returns all in one response — no pagination
  // on the Items endpoint. For very large catalogs (>1000) we'd need to chunk
  // but Centrefit is nowhere near that.
  let xeroItems: Array<{
    itemID?: string;
    code?: string;
    name?: string;
    description?: string;
    purchaseDescription?: string;
    salesDetails?: { unitPrice?: number };
    purchaseDetails?: { unitPrice?: number };
  }> = [];
  try {
    const res = await client.accountingApi.getItems(conn.tenant_id);
    xeroItems = res.body.items ?? [];
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: `Failed to fetch Xero items: ${msg}` }, { status: 500 });
  }

  const xeroByCode = new Map<string, (typeof xeroItems)[number]>();
  const xeroById = new Map<string, (typeof xeroItems)[number]>();
  for (const it of xeroItems) {
    if (it.code) xeroByCode.set(it.code, it);
    if (it.itemID) xeroById.set(it.itemID, it);
  }

  const noSku: { productId: string; name: string }[] = [];
  const newItems: NewItem[] = [];
  const linkedUpdates: LinkedUpdate[] = [];
  const collisions: Collision[] = [];

  for (const p of products ?? []) {
    if (!p.sku || p.sku.trim() === "") {
      noSku.push({ productId: p.id, name: p.name });
      continue;
    }
    const code = p.sku.slice(0, 30);
    const crmSell = Number(p.sell_price) || 0;
    const crmCost = Number(p.cost_price) || 0;
    const crmDescription = p.category
      ? `${p.category}${p.supplier ? ` — ${p.supplier}` : ""}`
      : p.supplier ?? null;
    const crmName = (p.name || p.sku).slice(0, 50);

    // Already linked — will UPDATE the linked item
    if (p.xero_item_id && xeroById.has(p.xero_item_id)) {
      linkedUpdates.push({
        productId: p.id,
        sku: p.sku,
        xeroItemId: p.xero_item_id,
        crmName,
      });
      continue;
    }

    const existing = xeroByCode.get(code);
    if (existing) {
      // Collision — would overwrite existing Xero item
      const changes: Collision["changes"] = [];
      if ((existing.name ?? null) !== crmName) {
        changes.push({ field: "name", from: existing.name ?? null, to: crmName });
      }
      if ((existing.description ?? null) !== crmDescription) {
        changes.push({
          field: "description",
          from: existing.description ?? null,
          to: crmDescription,
        });
      }
      const xeroSell = existing.salesDetails?.unitPrice ?? null;
      if (xeroSell !== crmSell) {
        changes.push({ field: "sell_price", from: xeroSell, to: crmSell });
      }
      const xeroCost = existing.purchaseDetails?.unitPrice ?? null;
      if (xeroCost !== crmCost) {
        changes.push({ field: "cost_price", from: xeroCost, to: crmCost });
      }
      if ((existing.purchaseDescription ?? null) !== (p.supplier ?? null)) {
        changes.push({
          field: "supplier",
          from: existing.purchaseDescription ?? null,
          to: p.supplier ?? null,
        });
      }
      collisions.push({
        productId: p.id,
        sku: p.sku,
        crmName,
        xeroName: existing.name ?? null,
        xeroItemId: existing.itemID ?? null,
        changes,
      });
      continue;
    }

    // New — would create fresh Xero item
    newItems.push({
      productId: p.id,
      sku: p.sku,
      name: crmName,
      sellPrice: crmSell,
      costPrice: crmCost,
    });
  }

  return NextResponse.json({
    tenantName: conn.tenant_name,
    xeroItemCount: xeroItems.length,
    crmProductCount: products?.length ?? 0,
    summary: {
      wouldCreate: newItems.length,
      wouldUpdateLinked: linkedUpdates.length,
      wouldUpdateCollisions: collisions.length,
      wouldSkipNoSku: noSku.length,
    },
    newItems,
    linkedUpdates,
    collisions,
    noSku,
  });
}
