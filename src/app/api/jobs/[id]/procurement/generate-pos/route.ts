import { createHash } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getAuthedClient } from "@/lib/xero/client";
import { findOrCreateSupplierContact } from "@/lib/xero/contacts";
import {
  createXeroPurchaseOrder,
  type XeroPOLineItem,
} from "@/lib/xero/purchase-orders";
import { ensureXeroItem, xeroErrorMessage, type SyncableProduct } from "@/lib/xero/items";

interface ItemRow {
  id: string;
  product_id: string | null;
  product_name: string;
  sku: string | null;
  quantity: number;
  actual_supplier_id: string | null;
  quote_line_item_id: string | null;
  quote_line_items: { cost_price: number | null } | null;
}

interface SupplierRow {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  account_number: string | null;
  xero_contact_id: string | null;
}

/**
 * Generate draft Xero POs for all status='order' items on this job.
 * Groups by actual_supplier_id — one PO per supplier.
 *
 * Best-effort per supplier: if one supplier group fails (bad data, Xero
 * outage), others still proceed. Failures are returned in a per-group
 * summary so staff can retry after fixing the offending rows.
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: jobId } = await params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  // Fetch job + site details for the PO delivery address / reference
  const { data: job, error: jobErr } = await supabase
    .from("jobs")
    .select(`id, number`)
    .eq("id", jobId)
    .maybeSingle();
  if (jobErr) return NextResponse.json({ error: jobErr.message }, { status: 500 });
  if (!job) return NextResponse.json({ error: "Job not found" }, { status: 404 });

  // PO delivery address is the Centrefit warehouse, NOT the job's site.
  // Stock arrives at HQ for staging/QA then gets dispatched to site with
  // a Centrefit van — so the supplier's drop point is always the same.
  const deliveryAddress = "1/25 Paisley Drive, Lawnton, QLD, 4501";

  // Pull all items ready to order
  const { data: items, error: itemsErr } = await supabase
    .from("job_procurement_items")
    .select(`
      id, product_id, product_name, sku, quantity, actual_supplier_id, quote_line_item_id,
      quote_line_items ( cost_price )
    `)
    .eq("job_id", jobId)
    .eq("status", "order");
  if (itemsErr) return NextResponse.json({ error: itemsErr.message }, { status: 500 });
  if (!items || items.length === 0) {
    return NextResponse.json(
      { error: "No items marked ORDER on this job" },
      { status: 400 },
    );
  }

  // Pull LIVE pricing + Xero sync state from the product catalogue, keyed by
  // product_id. The PO must reflect the current cost in the products settings
  // page — NOT the cost snapshotted onto the quote line when the quote was
  // built (those drift as suppliers update prices). We also need xero_item_id
  // to decide whether the SKU is safe to send as a Xero ItemCode (see below).
  const productIds = Array.from(
    new Set(
      (items as unknown as ItemRow[])
        .map((it) => it.product_id)
        .filter((v): v is string => !!v),
    ),
  );
  const liveProducts = new Map<string, SyncableProduct>();
  if (productIds.length > 0) {
    const { data: prods } = await supabase
      .from("quote_products")
      .select("id, name, sku, category, supplier, cost_price, sell_price, xero_item_id")
      .in("id", productIds);
    for (const p of (prods ?? []) as SyncableProduct[]) {
      liveProducts.set(p.id, p);
    }
  }

  // Resolve the unit cost for a row: live catalogue price wins, then the
  // quote-time snapshot, then 0 (surfaced to the UI as zero-priced).
  const resolveCost = (it: ItemRow): number => {
    const live = it.product_id ? liveProducts.get(it.product_id)?.cost_price : null;
    if (live != null && Number(live) > 0) return Number(live);
    return Number(it.quote_line_items?.cost_price ?? 0);
  };

  // Rows missing a supplier can't be ordered — surface them so staff can fix
  const typedItems = items as unknown as ItemRow[];
  const orphans = typedItems.filter((it) => !it.actual_supplier_id);
  const actionable = typedItems.filter(
    (it): it is ItemRow & { actual_supplier_id: string } => !!it.actual_supplier_id,
  );

  // Group by supplier id
  const grouped = new Map<string, (ItemRow & { actual_supplier_id: string })[]>();
  for (const it of actionable) {
    const list = grouped.get(it.actual_supplier_id) ?? [];
    list.push(it);
    grouped.set(it.actual_supplier_id, list);
  }

  const supplierIds = Array.from(grouped.keys());
  const { data: suppliers, error: suppErr } = await supabase
    .from("suppliers")
    .select("id, name, email, phone, account_number, xero_contact_id")
    .in("id", supplierIds);
  if (suppErr) return NextResponse.json({ error: suppErr.message }, { status: 500 });

  const supplierById = new Map<string, SupplierRow>();
  for (const s of (suppliers ?? []) as SupplierRow[]) supplierById.set(s.id, s);

  const { client: xero, conn } = await getAuthedClient();

  // Ensure every distinct product on this PO run exists as a Xero Item with its
  // CURRENT catalogue cost, so (a) the SKU can go in the Xero ItemCode column
  // rather than the description, and (b) the Item master price never lags the
  // catalogue. Create-or-update is idempotent; failures degrade that line to a
  // description-only PO line rather than aborting the whole generation.
  const ensuredItemMap = new Map<string, string>(); // product_id → xero ItemID
  const itemSyncWarnings: string[] = [];
  {
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
    for (const pid of productIds) {
      const prod = liveProducts.get(pid);
      if (!prod || !prod.sku || prod.sku.trim() === "") continue;
      try {
        const xeroItemId = await ensureXeroItem(xero, conn.tenant_id, prod);
        if (xeroItemId) {
          ensuredItemMap.set(pid, xeroItemId);
          if (xeroItemId !== prod.xero_item_id) {
            await supabase
              .from("quote_products")
              .update({ xero_item_id: xeroItemId, xero_synced_at: new Date().toISOString() })
              .eq("id", pid);
          }
        }
      } catch (err) {
        itemSyncWarnings.push(`${prod.name}: ${err instanceof Error ? err.message : String(err)}`);
      }
      await sleep(75); // stay well under Xero's 60 calls/min limit
    }
  }

  const created: {
    supplierId: string;
    supplierName: string;
    purchaseOrderID: string;
    purchaseOrderNumber: string | null;
    itemCount: number;
  }[] = [];
  const failures: { supplierId: string; supplierName?: string; message: string }[] = [];

  // Surface lines we're about to push at $0 so the UI can warn — these go to
  // Xero with a zero unit amount for Mitchell to correct before authorising.
  const zeroPriced = actionable.filter((it) => resolveCost(it) <= 0);

  for (const [supplierId, rows] of grouped) {
    const supplier = supplierById.get(supplierId);
    if (!supplier) {
      failures.push({ supplierId, message: "Supplier record not found" });
      continue;
    }

    try {
      const xeroSupplierContactId = await findOrCreateSupplierContact(
        supabase,
        xero,
        conn.tenant_id,
        {
          id: supplier.id,
          name: supplier.name,
          xero_contact_id: supplier.xero_contact_id,
          email: supplier.email,
          phone: supplier.phone,
          account_number: supplier.account_number,
        },
      );

      // Use the quote-time cost_price as the PO unit amount. Prices should
      // have been confirmed with the supplier during quoting (see supplier
      // pricing flow on the quote detail page). If some lines are still
      // estimated, the PO goes out with best-available numbers and Mitchell
      // can update in Xero before authorising.
      const lineItems: XeroPOLineItem[] = rows.map<XeroPOLineItem>((r) => {
        // Put the SKU in the Xero ItemCode column. We just ensured every
        // SKU'd product exists as a Xero Item above, so this is safe; products
        // with no SKU (or whose Item sync failed) fall back to "name (SKU)" in
        // the description so the part number stays visible without breaking the
        // PO (Xero rejects an itemCode that doesn't match an existing Item).
        const synced = r.product_id ? ensuredItemMap.has(r.product_id) : false;
        // The Xero Item was ensured under the CATALOGUE SKU — use that for the
        // ItemCode, not the procurement row's snapshot, which drifts if the
        // SKU was edited in settings after the quote was built.
        const catalogueSku = r.product_id ? liveProducts.get(r.product_id)?.sku : null;
        const itemCode = synced && catalogueSku ? catalogueSku.slice(0, 30) : undefined;
        const description =
          !itemCode && r.sku ? `${r.product_name} (${r.sku})` : r.product_name;
        return {
          description,
          itemCode,
          quantity: Number(r.quantity),
          unitAmount: resolveCost(r),
        };
      });

      // Idempotency key derived from the exact row set AND line content so a
      // double-click or network retry can't duplicate the PO (24h window at
      // Xero), but a regenerate after prices/SKUs/triage change gets a fresh
      // key. Keying on row ids alone broke the reset→regenerate flow: same
      // key + different body is an idempotency conflict Xero rejects outright.
      const rowFingerprint = createHash("sha1")
        .update(rows.map((r) => r.id).sort().join(",") + "|" + JSON.stringify(lineItems))
        .digest("hex")
        .slice(0, 16);
      const idempotencyKey = `po-${jobId}-${supplierId}-${rowFingerprint}`.slice(0, 128);

      const po = await createXeroPurchaseOrder({
        xero,
        tenantId: conn.tenant_id,
        supplierContactId: xeroSupplierContactId,
        lineItems,
        // job.number is already prefixed "CFA…" — don't double it to "CFA-CFA…"
        reference: job.number,
        deliveryAddress,
        idempotencyKey,
      });

      // Mark rows ordered
      const orderedAt = new Date().toISOString();
      const rowIds = rows.map((r) => r.id);
      const { error: updErr } = await supabase
        .from("job_procurement_items")
        .update({
          status: "ordered",
          xero_po_id: po.purchaseOrderID,
          xero_po_number: po.purchaseOrderNumber,
          ordered_at: orderedAt,
        })
        .in("id", rowIds);
      if (updErr) throw new Error(`Xero PO ${po.purchaseOrderNumber ?? po.purchaseOrderID} created but local update failed: ${updErr.message}`);

      created.push({
        supplierId,
        supplierName: supplier.name,
        purchaseOrderID: po.purchaseOrderID,
        purchaseOrderNumber: po.purchaseOrderNumber,
        itemCount: rows.length,
      });
    } catch (err) {
      failures.push({
        supplierId,
        supplierName: supplier.name,
        message: xeroErrorMessage(err),
      });
    }
  }

  return NextResponse.json({
    ok: failures.length === 0,
    created,
    failures,
    unassignedCount: orphans.length,
    unassignedItemIds: orphans.map((o) => o.id),
    zeroPricedCount: zeroPriced.length,
    itemSyncWarnings,
  });
}
