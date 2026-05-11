import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { getMandate } from "@/lib/gocardless/client";

/**
 * Diagnose recurring plans stuck in `pending_mandate`. For each plan with a
 * gc_mandate_id, fetches the live GC mandate status so we can see whether the
 * mandate is genuinely active at GC (meaning our webhook handler missed it)
 * versus still pending/failed at GC (meaning there's nothing to do).
 *
 * Read-only — no DB writes, no plan activation. Auth-gated to logged-in users.
 */
export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });

  const svc = createServiceRoleClient();
  const { data: plans, error } = await svc
    .from("recurring_plans")
    .select(`
      id, status, created_at, gc_customer_id, gc_mandate_id, gc_billing_request_id,
      xero_repeating_invoice_id, first_invoice_date,
      customers(name)
    `)
    .eq("status", "pending_mandate")
    .not("gc_mandate_id", "is", null)
    .order("created_at", { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const results = await Promise.all(
    (plans ?? []).map(async (plan) => {
      const customer = Array.isArray(plan.customers) ? plan.customers[0] : plan.customers;
      try {
        const m = await getMandate(plan.gc_mandate_id!);
        return {
          plan_id: plan.id,
          customer: customer?.name ?? null,
          plan_created: plan.created_at,
          first_invoice_date: plan.first_invoice_date,
          gc_mandate_id: plan.gc_mandate_id,
          gc_mandate_status: m.status,
          gc_mandate_scheme: m.scheme,
          activatable: m.status === "active",
        };
      } catch (err) {
        return {
          plan_id: plan.id,
          customer: customer?.name ?? null,
          plan_created: plan.created_at,
          gc_mandate_id: plan.gc_mandate_id,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    }),
  );

  return NextResponse.json({
    count: results.length,
    plans: results,
  });
}
