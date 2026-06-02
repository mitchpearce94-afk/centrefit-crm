import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { activatePlan } from "@/lib/recurring/activate-plan";

/**
 * Backfill GoCardless subscriptions onto recurring plans that were activated
 * BEFORE subscriptions existed — they have a mandate + Xero RepeatingInvoice
 * but no GC subscription, so nothing was ever charged.
 *
 * Re-runs activatePlan for each such plan. activatePlan is idempotent: it
 * reuses the existing Xero RI (won't duplicate) and creates the missing GC
 * subscription with a stable idempotency key (won't double-subscribe).
 *
 * Admin-only (enforced by middleware on the /api/admin segment). POST so it's
 * a deliberate action, not URL-triggerable.
 */
export async function POST() {
  const svc = createServiceRoleClient();

  const { data: plans, error } = await svc
    .from("recurring_plans")
    .select("id, status, gc_mandate_id, gc_subscription_id")
    .eq("status", "active")
    .not("gc_mandate_id", "is", null)
    .is("gc_subscription_id", null);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!plans || plans.length === 0) {
    return NextResponse.json({ ok: true, candidates: 0, results: [] });
  }

  const results: { planId: string; ok: boolean; detail: string }[] = [];
  for (const p of plans) {
    const r = await activatePlan(svc, p.id);
    if (r.ok) {
      results.push({ planId: p.id, ok: true, detail: "activated" in r ? "subscription created" : r.skipped });
    } else {
      results.push({ planId: p.id, ok: false, detail: r.reason });
    }
  }

  return NextResponse.json({
    ok: true,
    candidates: plans.length,
    created: results.filter((r) => r.ok).length,
    failed: results.filter((r) => !r.ok).length,
    results,
  });
}
