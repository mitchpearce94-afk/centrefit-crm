import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * PATCH a single quote line's pricing after a supplier has confirmed it.
 *
 * Body:
 *   {
 *     cost_price: number,          // required — the confirmed unit cost
 *     markup?: number,             // optional override; if omitted, keeps line's current markup
 *     recalculate_sell?: boolean   // default true — recompute sell_price from cost * (1 + markup)
 *   }
 *
 * Sets cost_confirmed_at = now() on success. This is the signal that the
 * line's price came from a supplier, not the catalog default.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  let body: {
    cost_price?: number;
    markup?: number;
    recalculate_sell?: boolean;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (typeof body.cost_price !== "number" || body.cost_price < 0) {
    return NextResponse.json(
      { error: "cost_price must be a non-negative number" },
      { status: 400 },
    );
  }

  const { data: line, error: fetchErr } = await supabase
    .from("quote_line_items")
    .select("id, markup, sell_price, product_id")
    .eq("id", id)
    .maybeSingle();
  if (fetchErr) return NextResponse.json({ error: fetchErr.message }, { status: 500 });
  if (!line) return NextResponse.json({ error: "Line not found" }, { status: 404 });

  const markup =
    typeof body.markup === "number" && body.markup >= 0
      ? body.markup
      : Number(line.markup ?? 0);

  const update: Record<string, unknown> = {
    cost_price: body.cost_price,
    markup,
    cost_confirmed_at: new Date().toISOString(),
  };

  if (body.recalculate_sell !== false) {
    update.sell_price = Number((body.cost_price * (1 + markup)).toFixed(2));
  }

  const { data: updated, error: updErr } = await supabase
    .from("quote_line_items")
    .update(update)
    .eq("id", id)
    .select()
    .single();
  if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 });

  // Propagate confirmed price back to the product catalog so future quotes
  // pull the fresh cost without needing another RFQ round. We only update
  // cost_price + markup + cost_updated_at; sell_price is a generated column
  // on quote_products so it auto-recalcs.
  //
  // Deliberately does NOT update the product name, SKU, supplier, etc. Those
  // stay as-is — Mitchell edits them in the product catalog UI if needed.
  if ((line as { product_id?: string | null }).product_id) {
    await supabase
      .from("quote_products")
      .update({
        cost_price: body.cost_price,
        markup,
        cost_updated_at: new Date().toISOString(),
      })
      .eq("id", (line as { product_id: string }).product_id);
  }

  return NextResponse.json({ line: updated });
}
