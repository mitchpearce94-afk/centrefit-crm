import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { procurementPaymentBlock } from "@/lib/procurement/payment-gate";

/**
 * Ad-hoc procurement for service jobs (Mitchell, 2026-06-02).
 *
 * Not every job has an accepted quote BOM to init from — service jobs often
 * just need a few parts. This lets staff pick parts straight on the job's
 * procurement tab; the rows land as status='order' so they flow into the
 * existing draft-PO generation (grouped by supplier → draft Xero POs).
 *
 *   GET  → active product catalogue to pick from
 *   POST → { items: [{ productId, quantity }] } adds them to the job
 */

export async function GET(
  _req: NextRequest,
  _ctx: { params: Promise<{ id: string }> },
) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });

  const { data, error } = await supabase
    .from("quote_products")
    .select("id, name, sku, supplier_id")
    .eq("is_active", true)
    .order("name");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({
    products: (data ?? []).map((p) => ({
      id: p.id,
      name: p.name ?? "",
      sku: p.sku ?? "",
      supplierId: p.supplier_id ?? null,
    })),
  });
}

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id: jobId } = await ctx.params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as {
    items?: { productId: string; quantity?: number }[];
  };
  const wanted = (body.items ?? []).filter((i) => i.productId && (i.quantity ?? 1) > 0);
  if (wanted.length === 0) {
    return NextResponse.json({ error: "Pick at least one part" }, { status: 400 });
  }

  // Payment gate applies on ENTRY only: if the job already has procurement
  // rows (started before the gate shipped, or entered while paid up), staff
  // can keep adding parts to it.
  const { data: existingRows } = await supabase
    .from("job_procurement_items")
    .select("id")
    .eq("job_id", jobId)
    .limit(1);
  if (!existingRows || existingRows.length === 0) {
    const blocked = await procurementPaymentBlock(supabase, jobId);
    if (blocked) {
      return NextResponse.json({ error: blocked }, { status: 400 });
    }
  }

  // Resolve product details (name/sku/supplier) for the chosen ids.
  const ids = [...new Set(wanted.map((i) => i.productId))];
  const { data: products, error: prodErr } = await supabase
    .from("quote_products")
    .select("id, name, sku, supplier_id")
    .in("id", ids);
  if (prodErr) return NextResponse.json({ error: prodErr.message }, { status: 500 });

  const byId = new Map((products ?? []).map((p) => [p.id, p]));
  const rows = wanted
    .map((i) => {
      const p = byId.get(i.productId);
      if (!p) return null;
      const supplierId = p.supplier_id ?? null;
      return {
        job_id: jobId,
        quote_line_item_id: null,
        product_id: p.id,
        product_name: p.name ?? "Part",
        sku: p.sku ?? null,
        default_supplier_id: supplierId,
        actual_supplier_id: supplierId,
        quantity: i.quantity ?? 1,
        status: "order" as const,
      };
    })
    .filter(Boolean);

  if (rows.length === 0) {
    return NextResponse.json({ error: "None of the selected products were found" }, { status: 400 });
  }

  const { data: inserted, error: insErr } = await supabase
    .from("job_procurement_items")
    .insert(rows as object[])
    .select("id");
  if (insErr) return NextResponse.json({ error: insErr.message }, { status: 500 });

  return NextResponse.json({ ok: true, created: inserted?.length ?? 0 });
}
