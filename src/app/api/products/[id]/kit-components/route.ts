import { NextRequest, NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { requireProductsManager } from "@/lib/products/guard";
import { getCurrentStaff } from "@/lib/auth/current-staff";

/**
 * Kit components (docs/quoting-v2-CONTEXT.md D1): "quoting this product
 * requires these parts". Rows start 'proposed' (from the rule migration or a
 * gap) and expand in the BOM only once 'approved' — Mitchell owns approval.
 *   PUT    { component_product_id, qty_mode, qty_value, qty_per?, qty_formula?, qty_device_type?, requirement, ask_prompt?, notes? }  → upsert (approved)
 *   PATCH  { id, status?, qty_mode?, qty_value?, qty_per?, qty_formula?, requirement?, ask_prompt?, notes? }
 *   DELETE { id }
 */
const MODES = new Set(["per_unit", "fixed", "per_n", "formula", "per_device_type"]);
const REQ = new Set(["required", "optional", "ask"]);

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: kitId } = await params;
  const gate = await requireProductsManager();
  if (!gate.ok) return gate.response;
  const staff = await getCurrentStaff();
  const b = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!b) return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  const componentId = String(b.component_product_id ?? "");
  if (!componentId) return NextResponse.json({ error: "Pick a component product" }, { status: 400 });
  if (componentId === kitId) return NextResponse.json({ error: "A kit can't contain itself" }, { status: 400 });
  const qty_mode = MODES.has(String(b.qty_mode)) ? String(b.qty_mode) : "per_unit";
  const requirement = REQ.has(String(b.requirement)) ? String(b.requirement) : "required";
  const qty_value = Number(b.qty_value ?? 1);
  if (!(qty_value >= 0)) return NextResponse.json({ error: "Quantity must be 0 or more" }, { status: 400 });
  if (requirement === "ask" && !String(b.ask_prompt ?? "").trim()) return NextResponse.json({ error: "An 'ask' component needs the question to show" }, { status: 400 });
  if (qty_mode === "formula" && !String(b.qty_formula ?? "").trim()) return NextResponse.json({ error: "A formula component needs the formula" }, { status: 400 });
  const svc = createServiceRoleClient();
  const row = {
    kit_product_id: kitId, component_product_id: componentId, qty_mode, qty_value,
    qty_per: b.qty_per != null && b.qty_per !== "" ? Number(b.qty_per) : null,
    qty_formula: b.qty_formula ? String(b.qty_formula) : null,
    qty_device_type: b.qty_device_type ? String(b.qty_device_type) : null,
    requirement, ask_prompt: b.ask_prompt ? String(b.ask_prompt) : null, notes: b.notes ? String(b.notes) : null,
    // Gaps inbox proposals come in as source 'gap_inbox' and may be rejected
    // straight away (Dismiss) so the pair stops being suggested.
    status: b.source === "gap_inbox" && b.status === "rejected" ? "rejected" : "approved",
    source: b.source === "gap_inbox" ? "gap_inbox" : "manual",
    decided_by: staff?.id ?? null, decided_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    sort_order: Number(b.sort_order ?? 100),
  };
  const { data, error } = await svc.from("product_kit_components").insert(row).select("id").single();
  if (error) return NextResponse.json({ error: error.code === "23505" ? "That component is already on this kit with that quantity mode" : error.message }, { status: 500 });
  await svc.from("quote_products").update({ is_kit: true }).eq("id", kitId);
  return NextResponse.json({ ok: true, id: data?.id });
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: kitId } = await params;
  const gate = await requireProductsManager();
  if (!gate.ok) return gate.response;
  const staff = await getCurrentStaff();
  const b = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!b?.id) return NextResponse.json({ error: "id required" }, { status: 400 });
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (typeof b.status === "string" && ["proposed", "approved", "rejected"].includes(b.status)) { patch.status = b.status; patch.decided_by = staff?.id ?? null; patch.decided_at = new Date().toISOString(); }
  if (typeof b.qty_mode === "string" && MODES.has(b.qty_mode)) patch.qty_mode = b.qty_mode;
  if (b.qty_value != null && Number(b.qty_value) >= 0) patch.qty_value = Number(b.qty_value);
  if ("qty_per" in b) patch.qty_per = b.qty_per != null && b.qty_per !== "" ? Number(b.qty_per) : null;
  if ("qty_formula" in b) patch.qty_formula = b.qty_formula ? String(b.qty_formula) : null;
  if ("qty_device_type" in b) patch.qty_device_type = b.qty_device_type ? String(b.qty_device_type) : null;
  if (typeof b.requirement === "string" && REQ.has(b.requirement)) patch.requirement = b.requirement;
  if ("ask_prompt" in b) patch.ask_prompt = b.ask_prompt ? String(b.ask_prompt) : null;
  if ("notes" in b) patch.notes = b.notes ? String(b.notes) : null;
  const svc = createServiceRoleClient();
  const { error } = await svc.from("product_kit_components").update(patch).eq("id", String(b.id)).eq("kit_product_id", kitId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: kitId } = await params;
  const gate = await requireProductsManager();
  if (!gate.ok) return gate.response;
  const b = (await req.json().catch(() => null)) as { id?: string } | null;
  if (!b?.id) return NextResponse.json({ error: "id required" }, { status: 400 });
  const svc = createServiceRoleClient();
  const { error } = await svc.from("product_kit_components").delete().eq("id", b.id).eq("kit_product_id", kitId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const { count } = await svc.from("product_kit_components").select("id", { count: "exact", head: true }).eq("kit_product_id", kitId);
  if (!count) await svc.from("quote_products").update({ is_kit: false }).eq("id", kitId);
  return NextResponse.json({ ok: true });
}
