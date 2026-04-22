import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getAuthedClient } from "@/lib/xero/client";
import { findOrCreateSupplierContact } from "@/lib/xero/contacts";
import {
  createXeroPurchaseOrder,
  type XeroPOLineItem,
} from "@/lib/xero/purchase-orders";

interface ItemRow {
  id: string;
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
    .select(`
      id, number,
      customer_sites ( name, address, suburb, state, postcode )
    `)
    .eq("id", jobId)
    .maybeSingle();
  if (jobErr) return NextResponse.json({ error: jobErr.message }, { status: 500 });
  if (!job) return NextResponse.json({ error: "Job not found" }, { status: 404 });

  const siteRow = job.customer_sites as
    | { name?: string; address?: string; suburb?: string; state?: string; postcode?: string }
    | null;
  const deliveryAddress = siteRow
    ? [siteRow.address, siteRow.suburb, siteRow.state, siteRow.postcode]
        .filter(Boolean)
        .join(", ")
    : undefined;

  // Pull all items ready to order
  const { data: items, error: itemsErr } = await supabase
    .from("job_procurement_items")
    .select(`
      id, product_name, sku, quantity, actual_supplier_id, quote_line_item_id,
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

  const created: {
    supplierId: string;
    supplierName: string;
    purchaseOrderID: string;
    purchaseOrderNumber: string | null;
    itemCount: number;
  }[] = [];
  const failures: { supplierId: string; supplierName?: string; message: string }[] = [];

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

      const lineItems: XeroPOLineItem[] = rows.map((r) => {
        const lineCost = Number(r.quote_line_items?.cost_price ?? 0);
        const desc = r.sku ? `${r.product_name} (${r.sku})` : r.product_name;
        return {
          description: desc,
          quantity: Number(r.quantity),
          unitAmount: lineCost,
        };
      });

      const po = await createXeroPurchaseOrder({
        xero,
        tenantId: conn.tenant_id,
        supplierContactId: xeroSupplierContactId,
        lineItems,
        reference: job.number,
        deliveryAddress,
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
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return NextResponse.json({
    ok: failures.length === 0,
    created,
    failures,
    unassignedCount: orphans.length,
    unassignedItemIds: orphans.map((o) => o.id),
  });
}
