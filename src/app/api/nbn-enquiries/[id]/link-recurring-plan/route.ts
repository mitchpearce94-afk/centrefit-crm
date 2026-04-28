import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * POST /api/nbn-enquiries/[id]/link-recurring-plan
 *
 * Tiny endpoint called by the wizard immediately after a successful plan
 * creation when the wizard was launched via the convert-from-enquiry flow.
 * Stamps the new recurring_plan_id back on the enquiry so the detail page
 * shows the link instead of the convert button on next visit.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  let body: { recurringPlanId?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  if (!body.recurringPlanId) {
    return NextResponse.json({ error: "recurringPlanId required" }, { status: 400 });
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });

  const { error } = await supabase
    .from("nbn_enquiries")
    .update({ recurring_plan_id: body.recurringPlanId, status: "in_progress" })
    .eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
