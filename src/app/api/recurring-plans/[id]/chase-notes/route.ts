import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * PATCH /api/recurring-plans/[id]/chase-notes — save staff chasing notes on a
 * draft / awaiting-mandate plan. User-scoped client so RLS enforces
 * invoices.manage_recurring. Separate column from `notes` (system/error
 * breadcrumbs, which several routes overwrite).
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const notes = typeof body?.notes === "string" ? body.notes.trim().slice(0, 2000) : "";

  const { data: plan } = await supabase
    .from("recurring_plans")
    .select("id, status")
    .eq("id", id)
    .maybeSingle();
  if (!plan) return NextResponse.json({ error: "Plan not found" }, { status: 404 });
  if (plan.status !== "draft" && plan.status !== "pending_mandate") {
    return NextResponse.json(
      { error: "Chasing notes only apply while the plan is awaiting its mandate" },
      { status: 400 },
    );
  }

  const { error, data: rows } = await supabase
    .from("recurring_plans")
    .update({ mandate_chase_notes: notes || null })
    .eq("id", id)
    .select("id");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!rows || rows.length === 0) {
    return NextResponse.json({ error: "No permission to update this plan" }, { status: 403 });
  }

  return NextResponse.json({ ok: true });
}
