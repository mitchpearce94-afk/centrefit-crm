import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { activatePlan } from "@/lib/recurring/activate-plan";

/**
 * Manual retry endpoint for a stuck recurring plan — fired by the "Retry
 * activation" button on the plan detail page when Mitchell sees the red
 * banner. Unlike /activate-one this isn't allow-listed: any plan in
 * pending_mandate with a populated gc_mandate_id is fair game.
 *
 * Auth: must be an authenticated CRM user. Plans without a mandate yet
 * aren't retryable — there's nothing for activatePlan to bill against.
 */
export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const planId = (body?.planId ?? "").toString().trim();
  if (!planId) {
    return NextResponse.json({ error: "Missing planId" }, { status: 400 });
  }

  // Eligibility check on the user-scoped client so RLS still applies.
  const { data: plan } = await supabase
    .from("recurring_plans")
    .select("id, status, gc_mandate_id")
    .eq("id", planId)
    .maybeSingle();
  if (!plan) {
    return NextResponse.json({ error: "Plan not found" }, { status: 404 });
  }
  if (plan.status === "active") {
    return NextResponse.json({ error: "Plan is already active" }, { status: 409 });
  }
  if (!plan.gc_mandate_id) {
    return NextResponse.json(
      { error: "No mandate yet — customer hasn't signed. Resend the signup link instead." },
      { status: 400 },
    );
  }

  // Use the service-role client so activatePlan can write the mandate-active
  // notification + clear/record the activation error regardless of the
  // calling user's RLS scope.
  const svc = createServiceRoleClient();
  const result = await activatePlan(svc, planId);
  return NextResponse.json({ result });
}
