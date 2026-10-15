import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { currentUserHasPermission } from "@/lib/auth/permissions";
import { checkLowStock } from "@/lib/inventory/low-stock";

/**
 * POST /api/inventory/[id]/allocate — take stock off the shelf for a job
 * (Mitchell 2026-10-15: Sue allocates, the invoice picks it up, techs never
 * have to remember).
 *
 *   { job_id, quantity, note?, mode?: "extra" | "fulfil" }
 *
 * The allocation is a job_procurement_items row inserted as in_stock, so the
 * inventory trigger (docs/inventory-CONTEXT.md D4) does the decrement — one
 * ledger path for every way stock leaves. Rows are flagged
 * allocated_from_stock so the job's invoice builder adds them as billable
 * lines until invoiced_at is set.
 *
 * Double-billing guard: when the job's quote already has this part on order
 * (a quoted procurement row that is pending/order), the quote has billed it.
 * Without a mode we answer 409 + the existing row so the UI can ask; mode
 * "fulfil" marks that row in_stock from stock (not billed again), mode
 * "extra" adds a new billable row regardless.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  if (!(await currentUserHasPermission("inventory.manage"))) {
    return NextResponse.json({ error: "You don't have permission to manage inventory" }, { status: 403 });
  }

  let body: { job_id?: string; quantity?: number; note?: string | null; mode?: "extra" | "fulfil" };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const jobId = (body.job_id ?? "").trim();
  if (!/^[0-9a-f-]{36}$/i.test(jobId)) return NextResponse.json({ error: "Pick a job" }, { status: 400 });
  const quantity = Number(body.quantity);
  if (!Number.isFinite(quantity) || quantity <= 0) return NextResponse.json({ error: "Quantity must be more than 0" }, { status: 400 });
  const mode = body.mode === "fulfil" || body.mode === "extra" ? body.mode : null;

  const svc = createServiceRoleClient();
  const [{ data: item, error: itemErr }, { data: job }] = await Promise.all([
    svc
      .from("inventory_items")
      .select("id, product_id, qty_on_hand, product:quote_products(id, name, sku, supplier_id)")
      .eq("id", id)
      .maybeSingle(),
    svc.from("jobs").select("id, number").eq("id", jobId).maybeSingle(),
  ]);
  if (itemErr) return NextResponse.json({ error: itemErr.message }, { status: 500 });
  if (!item) return NextResponse.json({ error: "Stock item not found" }, { status: 404 });
  if (!job) return NextResponse.json({ error: "Job not found" }, { status: 404 });
  const product = (Array.isArray(item.product) ? item.product[0] : item.product) as
    | { id: string; name: string | null; sku: string | null; supplier_id: string | null }
    | null;

  const onHand = Number(item.qty_on_hand);
  if (quantity > onHand) {
    return NextResponse.json(
      { error: `Only ${onHand} on hand — do a stock take first if the cupboard says otherwise` },
      { status: 400 },
    );
  }

  // Quoted part already on this job and still to be sourced?
  const { data: quoted } = await svc
    .from("job_procurement_items")
    .select("id, quantity, status")
    .eq("job_id", jobId)
    .eq("product_id", item.product_id)
    .not("quote_line_item_id", "is", null)
    .in("status", ["pending", "order"])
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (quoted && mode === null) {
    return NextResponse.json(
      {
        error: "already_quoted",
        existing: { id: quoted.id, quantity: Number(quoted.quantity), status: quoted.status },
        jobNumber: job.number,
      },
      { status: 409 },
    );
  }

  const note = body.note?.trim() || null;
  let rowId: string;
  let fulfilled = false;

  if (quoted && mode === "fulfil") {
    // The quote billed this part; we're just sourcing it from the shelf.
    // Keep the quoted quantity — the trigger decrements by the row's quantity.
    if (Number(quoted.quantity) > onHand) {
      return NextResponse.json(
        { error: `The quote needs ${Number(quoted.quantity)} but only ${onHand} are on hand` },
        { status: 400 },
      );
    }
    const { error: updErr } = await svc
      .from("job_procurement_items")
      .update({
        status: "in_stock",
        allocated_from_stock: true,
        allocated_by: user.id,
        // fulfilling the quote: the quote already billed it, so mark it as
        // settled rather than leaving it for the invoice builder.
        invoiced_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", quoted.id);
    if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 });
    rowId = quoted.id;
    fulfilled = true;
  } else {
    const { data: inserted, error: insErr } = await svc
      .from("job_procurement_items")
      .insert({
        job_id: jobId,
        quote_line_item_id: null,
        product_id: item.product_id,
        product_name: product?.name ?? "Part",
        sku: product?.sku ?? null,
        default_supplier_id: product?.supplier_id ?? null,
        actual_supplier_id: product?.supplier_id ?? null,
        quantity,
        status: "in_stock",
        allocated_from_stock: true,
        allocated_by: user.id,
      })
      .select("id")
      .single();
    if (insErr || !inserted) return NextResponse.json({ error: insErr?.message ?? "Could not allocate" }, { status: 500 });
    rowId = inserted.id;
  }

  // The trigger ran on the service role, so the ledger row has no actor and
  // a generic note — stamp Sue on it and say what actually happened.
  const { data: staffRow } = await svc.from("staff").select("display_name").eq("id", user.id).maybeSingle();
  await svc
    .from("inventory_movements")
    .update({
      staff_id: user.id,
      note: `Allocated to ${job.number ?? "job"} from Inventory${fulfilled ? " (fulfils quoted part)" : ""}${note ? ` — ${note}` : ""}`,
    })
    .eq("ref_type", "job_procurement_item")
    .eq("ref_id", rowId)
    .is("staff_id", null);

  const { data: after } = await svc.from("inventory_items").select("qty_on_hand").eq("id", id).maybeSingle();
  await checkLowStock([item.product_id]);

  return NextResponse.json({
    ok: true,
    qty_on_hand: Number(after?.qty_on_hand ?? onHand - quantity),
    job_number: job.number,
    fulfilled,
    allocated_by: staffRow?.display_name ?? null,
  });
}
