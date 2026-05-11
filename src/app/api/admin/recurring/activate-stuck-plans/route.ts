import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { activatePlan } from "@/lib/recurring/activate-plan";

/**
 * One-shot backfill for recurring plans stuck in `pending_mandate` because
 * the original handler waited for `mandate.active` from GoCardless, which
 * never fires for AU BECS until the first payment is collected.
 *
 * For each pending plan with a gc_mandate_id AND a future first_invoice_date,
 * calls activatePlan to provision the Xero RepeatingInvoice. Skips plans
 * with no first_invoice_date (UI needs to set one before activation).
 *
 * POST-only, auth-gated.
 */
export async function POST() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });

  const svc = createServiceRoleClient();
  const { data: plans, error } = await svc
    .from("recurring_plans")
    .select(`
      id, first_invoice_date, gc_mandate_id,
      customers(name)
    `)
    .eq("status", "pending_mandate")
    .not("gc_mandate_id", "is", null);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const today = new Date().toISOString().slice(0, 10);
  const results: unknown[] = [];

  for (const plan of plans ?? []) {
    const customer = Array.isArray(plan.customers) ? plan.customers[0] : plan.customers;
    const label = customer?.name ?? plan.id;

    if (!plan.first_invoice_date) {
      results.push({
        plan_id: plan.id,
        customer: label,
        skipped: true,
        reason: "first_invoice_date is null — set a start date in the UI before activating",
      });
      continue;
    }

    if (plan.first_invoice_date < today) {
      results.push({
        plan_id: plan.id,
        customer: label,
        first_invoice_date: plan.first_invoice_date,
        skipped: true,
        reason: "first_invoice_date is in the past — update in UI, then re-run",
      });
      continue;
    }

    try {
      const result = await activatePlan(svc, plan.id);
      results.push({
        plan_id: plan.id,
        customer: label,
        first_invoice_date: plan.first_invoice_date,
        result,
      });
    } catch (err) {
      results.push({
        plan_id: plan.id,
        customer: label,
        first_invoice_date: plan.first_invoice_date,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return NextResponse.json({
    processed: results.length,
    results,
  });
}
