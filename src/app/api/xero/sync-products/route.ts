import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getAuthedClient } from "@/lib/xero/client";
import type { Item } from "xero-node";

/**
 * Push all quote_products into Xero as Items.
 * - `sku` → Xero `code` (the unique key)
 * - `cost_price` → `purchaseDetails.unitPrice`
 * - `sell_price` → `salesDetails.unitPrice`
 * - `supplier` → `purchaseDescription`
 * - `category` → `description`
 *
 * For each product:
 *   - If `xero_item_id` is already set, PUT update
 *   - Else, try CREATE — if Xero says the Code already exists, fetch by Code
 *     and fall back to UPDATE (so we survive manual items created in Xero
 *     that happen to share a SKU)
 *
 * Items are created as **untracked** (no inventory asset account) — this is
 * the safer default for Centrefit. Tracked items need account setup which
 * we'll layer in later if needed.
 */
export async function POST(req: NextRequest) {
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

  // Optional body: { productIds: string[] } — scope sync to specific products.
  // Absent = sync everything (original behavior).
  let productIds: string[] | null = null;
  try {
    const text = await req.text();
    if (text) {
      const body = JSON.parse(text) as { productIds?: unknown };
      if (Array.isArray(body.productIds)) {
        productIds = body.productIds.filter((v): v is string => typeof v === "string");
      }
    }
  } catch {
    // Invalid JSON — ignore, treat as full sync
  }

  let query = supabase
    .from("quote_products")
    .select("id, name, sku, category, supplier, cost_price, sell_price, xero_item_id, is_active");
  if (productIds && productIds.length > 0) {
    query = query.in("id", productIds);
  }
  const { data: products, error: prodErr } = await query;
  if (prodErr) {
    return NextResponse.json({ error: prodErr.message }, { status: 500 });
  }
  if (!products || products.length === 0) {
    return NextResponse.json({ ok: true, summary: { synced: 0, created: 0, updated: 0, skipped: 0, errors: [] } });
  }

  // Xero requires Code to be set and <=30 chars
  const eligible = products.filter((p) => p.sku && p.sku.trim() !== "");
  const skipped = products.length - eligible.length;

  let created = 0;
  let updated = 0;
  const errors: { sku: string; name: string; message: string }[] = [];

  // Xero rate limit: 60 calls/min. We throttle at 20 ops/sec to stay well under.
  const DELAY_MS = 75;
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  for (const p of eligible) {
    const item: Item = {
      code: p.sku.slice(0, 30),
      name: (p.name || p.sku).slice(0, 50),
      description: p.category ? `${p.category}${p.supplier ? ` — ${p.supplier}` : ""}` : p.supplier ?? undefined,
      purchaseDescription: p.supplier ?? undefined,
      isSold: true,
      isPurchased: true,
      isTrackedAsInventory: false,
      purchaseDetails: {
        unitPrice: Number(p.cost_price) || 0,
      },
      salesDetails: {
        unitPrice: Number(p.sell_price) || 0,
      },
    };

    try {
      let xeroItemId: string | null = p.xero_item_id ?? null;

      if (xeroItemId) {
        // UPDATE existing
        await client.accountingApi.updateItem(conn.tenant_id, xeroItemId, {
          items: [item],
        });
        updated++;
      } else {
        // CREATE — fall back to UPDATE if duplicate Code
        try {
          const res = await client.accountingApi.createItems(conn.tenant_id, {
            items: [item],
          });
          const newItem = res.body.items?.[0];
          xeroItemId = newItem?.itemID ?? null;
          created++;
        } catch (createErr: unknown) {
          // Xero returns 400 with "already exists" — look it up and update
          const isDuplicate =
            createErr &&
            typeof createErr === "object" &&
            "response" in createErr &&
            JSON.stringify(createErr).toLowerCase().includes("already");
          if (!isDuplicate) throw createErr;

          const existing = await client.accountingApi.getItems(
            conn.tenant_id,
            undefined,
            `Code=="${item.code}"`
          );
          const found = existing.body.items?.[0];
          if (!found?.itemID) throw createErr;
          await client.accountingApi.updateItem(conn.tenant_id, found.itemID, {
            items: [item],
          });
          xeroItemId = found.itemID;
          updated++;
        }
      }

      if (xeroItemId) {
        await supabase
          .from("quote_products")
          .update({
            xero_item_id: xeroItemId,
            xero_synced_at: new Date().toISOString(),
          })
          .eq("id", p.id);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : JSON.stringify(err);
      errors.push({ sku: p.sku, name: p.name, message: msg.slice(0, 300) });
    }

    await sleep(DELAY_MS);
  }

  const summary = {
    synced: created + updated,
    created,
    updated,
    skipped,
    errors,
    total: products.length,
  };

  await supabase
    .from("xero_connections")
    .update({
      last_sync_at: new Date().toISOString(),
      last_sync_result: summary,
    })
    .eq("id", conn.id);

  return NextResponse.json({ ok: true, summary });
}
