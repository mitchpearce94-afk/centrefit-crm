import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { sendSupplierRFQ, type RFQLine } from "@/lib/emails/supplier-rfq";

/**
 * Per-supplier RFQ — emails the supplier asking for refreshed pricing on
 * a set of products. By default (no body, or empty productIds) sends EVERY
 * active product we have from them — the monthly catalogue-refresh
 * workflow. Optionally accepts `{ productIds: [...] }` to scope the
 * request to a hand-picked subset.
 *
 * Replaces the per-quote RFQ that used to fire from the quote detail page.
 */
export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id: supplierId } = await ctx.params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  // Optional body for selected-only sends. Tolerate missing body / non-JSON
  // — the legacy callers fire POST with no body.
  let productIds: string[] | undefined;
  try {
    const body = await req.json();
    if (Array.isArray(body?.productIds) && body.productIds.length > 0) {
      productIds = body.productIds.filter((x: unknown): x is string => typeof x === "string");
    }
  } catch {
    // No JSON body — treat as "send all", legacy behaviour.
  }

  const { data: supplier, error: supErr } = await supabase
    .from("suppliers")
    .select("id, name, email, is_active")
    .eq("id", supplierId)
    .maybeSingle();
  if (supErr) return NextResponse.json({ error: supErr.message }, { status: 500 });
  if (!supplier) return NextResponse.json({ error: "Supplier not found" }, { status: 404 });
  if (!supplier.email) {
    return NextResponse.json(
      { error: `${supplier.name} has no email on file` },
      { status: 400 },
    );
  }
  if (!supplier.is_active) {
    return NextResponse.json({ error: "Supplier is inactive" }, { status: 400 });
  }

  let prodQuery = supabase
    .from("quote_products")
    .select("id, name, sku, cost_price")
    .eq("supplier_id", supplierId)
    .eq("is_active", true)
    .order("name");
  if (productIds && productIds.length > 0) {
    prodQuery = prodQuery.in("id", productIds);
  }

  const { data: products, error: prodErr } = await prodQuery;
  if (prodErr) return NextResponse.json({ error: prodErr.message }, { status: 500 });
  if (!products || products.length === 0) {
    return NextResponse.json(
      {
        error: productIds
          ? "None of the selected products belong to this supplier (or all are inactive)"
          : "No active products from this supplier to send",
      },
      { status: 400 },
    );
  }

  const lines: RFQLine[] = products.map((p) => ({
    productName: p.name,
    sku: p.sku ?? null,
    quantity: 1,
    lastKnownCost: p.cost_price != null ? Number(p.cost_price) : null,
  }));

  const now = new Date();
  const yyyymm = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}`;
  const supplierSlug = supplier.name
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 20);
  const reference = `RFQ-${yyyymm}-${supplierSlug}`;

  try {
    const result = await sendSupplierRFQ({
      supplierName: supplier.name,
      supplierEmail: supplier.email,
      quoteRef: reference,
      lines,
      purpose: "catalog_refresh",
    });

    return NextResponse.json({
      ok: true,
      lineCount: lines.length,
      reference,
      emailId: result.emailId,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
