import { NextRequest, NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { completeRedirectFlow } from "@/lib/gocardless/client";

/**
 * Public completion endpoint.
 *
 * After the customer signs the mandate on the GoCardless-hosted form, GC
 * redirects them to /recurring-thanks?redirect_flow_id=<id>. That page hits
 * this endpoint to finalise the redirect flow with GC, which:
 *   1. Confirms the redirect flow with our session_token (= plan.id), and
 *   2. Returns the now-created customer_id + mandate_id linked to the flow.
 *
 * We persist those IDs onto the plan so the subsequent webhook event
 * (mandate moves to active) can find the plan by gc_mandate_id.
 *
 * Idempotent: GC's /complete endpoint can be called multiple times with the
 * same session_token and returns the same result. We also short-circuit
 * if the plan already has a mandate ID populated.
 *
 * Auth: public (no session required) — verified via the session_token
 * matching the plan ID we issued at creation time. Anyone with both the
 * redirect_flow_id and the matching session_token can complete it, but
 * since the session_token is the plan UUID, brute-forcing it is infeasible.
 */
export async function POST(req: NextRequest) {
  let body: { redirect_flow_id?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const redirectFlowId = body.redirect_flow_id;
  if (!redirectFlowId) {
    return NextResponse.json({ error: "redirect_flow_id required" }, { status: 400 });
  }

  const supabase = createServiceRoleClient();

  const { data: plan } = await supabase
    .from("recurring_plans")
    .select("id, status, gc_mandate_id, gc_customer_id")
    .eq("gc_redirect_flow_id", redirectFlowId)
    .maybeSingle();
  if (!plan) {
    return NextResponse.json({ error: "Plan not found for this redirect flow" }, { status: 404 });
  }

  // Already completed — short-circuit.
  if (plan.gc_mandate_id) {
    return NextResponse.json({ planId: plan.id, status: "already_complete" });
  }

  try {
    const completed = await completeRedirectFlow(redirectFlowId, plan.id);
    const customerId = completed.links.customer ?? null;
    const mandateId = completed.links.mandate ?? null;

    await supabase
      .from("recurring_plans")
      .update({
        gc_customer_id: customerId,
        gc_mandate_id: mandateId,
      })
      .eq("id", plan.id);

    return NextResponse.json({ planId: plan.id, status: "completed", mandateId });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `Completion failed: ${msg}` }, { status: 502 });
  }
}
