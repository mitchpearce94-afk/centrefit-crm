import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * PATCH /api/recurring-plans/[id]/start-date
 *
 * Lets staff change first_invoice_date on a plan that's still pending the
 * customer's mandate signup / bank verification. Once the plan flips to
 * active, the Xero RepeatingInvoice schedule is canonical and this endpoint
 * refuses — staff would need to edit the RI directly in Xero (or we'd need
 * to add an UpdateSchedule helper, which Xero supports as a partial PATCH
 * but isn't wired up yet).
 *
 * Body: { firstInvoiceDate: string | null }   // YYYY-MM-DD or null
 */
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  let body: { firstInvoiceDate?: string | null };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });

  const { data: plan } = await supabase
    .from("recurring_plans")
    .select("id, status")
    .eq("id", id)
    .maybeSingle();
  if (!plan) return NextResponse.json({ error: "Plan not found" }, { status: 404 });
  if (plan.status !== "pending_mandate") {
    return NextResponse.json(
      { error: `Cannot edit start date on a ${plan.status} plan — change the schedule directly in Xero.` },
      { status: 409 },
    );
  }

  let firstInvoiceDate: string | null = null;
  if (body.firstInvoiceDate) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(body.firstInvoiceDate)) {
      return NextResponse.json({ error: "firstInvoiceDate must be YYYY-MM-DD" }, { status: 400 });
    }
    const today = new Date().toISOString().slice(0, 10);
    if (body.firstInvoiceDate < today) {
      return NextResponse.json({ error: "firstInvoiceDate cannot be in the past" }, { status: 400 });
    }
    firstInvoiceDate = body.firstInvoiceDate;
  }

  const { error } = await supabase
    .from("recurring_plans")
    .update({ first_invoice_date: firstInvoiceDate })
    .eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true, firstInvoiceDate });
}
