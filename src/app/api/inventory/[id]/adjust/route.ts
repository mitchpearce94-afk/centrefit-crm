import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { currentUserHasPermission } from "@/lib/auth/permissions";
import { checkLowStock } from "@/lib/inventory/low-stock";

const REASONS = new Set(["receive", "adjustment", "count", "return"]);

/**
 * Move stock on a tracked item through the ledger (docs/inventory-CONTEXT.md D3).
 *   { delta: +5, reason: "receive" }         — stock arrived
 *   { delta: -2, reason: "adjustment" }      — correction / damaged / lost
 *   { set_to: 14, reason: "count" }          — stock take: books the difference
 *   { delta: +1, reason: "return" }          — came back from a job
 * Job allocations never come through here — the procurement trigger owns those.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  if (!(await currentUserHasPermission("inventory.manage"))) {
    return NextResponse.json({ error: "You don't have permission to manage inventory" }, { status: 403 });
  }

  let body: { delta?: number; set_to?: number; reason?: string; note?: string | null };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const reason = (body.reason ?? "").trim();
  if (!REASONS.has(reason)) {
    return NextResponse.json({ error: `reason must be one of ${[...REASONS].join(", ")}` }, { status: 400 });
  }

  const svc = createServiceRoleClient();
  const { data: item, error: fetchErr } = await svc
    .from("inventory_items")
    .select("id, product_id, qty_on_hand")
    .eq("id", id)
    .maybeSingle();
  if (fetchErr) return NextResponse.json({ error: fetchErr.message }, { status: 500 });
  if (!item) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const current = Number(item.qty_on_hand);
  let delta: number;
  if (body.set_to !== undefined && body.set_to !== null) {
    const target = Number(body.set_to);
    if (!Number.isFinite(target) || target < 0) return NextResponse.json({ error: "set_to must be 0 or more" }, { status: 400 });
    delta = target - current;
  } else {
    delta = Number(body.delta);
    if (!Number.isFinite(delta) || delta === 0) return NextResponse.json({ error: "delta must be a non-zero number" }, { status: 400 });
  }
  if (delta === 0) {
    return NextResponse.json({ ok: true, qty_on_hand: current, unchanged: true });
  }
  if (current + delta < 0) {
    return NextResponse.json(
      { error: `That would take stock below zero (${current} on hand). Use a stock take to set the real count.` },
      { status: 400 },
    );
  }

  const { error: mvErr } = await svc.rpc("inventory_apply_movement", {
    p_product_id: item.product_id,
    p_delta: delta,
    p_reason: reason,
    p_ref_type: null,
    p_ref_id: null,
    p_job_id: null,
    p_staff_id: user.id,
    p_note: body.note?.trim() || null,
  });
  if (mvErr) return NextResponse.json({ error: mvErr.message }, { status: 500 });

  if (reason === "count") {
    await svc.from("inventory_items").update({ last_counted_at: new Date().toISOString() }).eq("id", id);
  }
  await checkLowStock([item.product_id]);
  return NextResponse.json({ ok: true, qty_on_hand: current + delta, delta });
}
