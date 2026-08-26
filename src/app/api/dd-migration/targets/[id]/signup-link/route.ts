import { NextRequest, NextResponse } from "next/server";
import { currentUserHasPermission } from "@/lib/auth/permissions";
import { getCurrentStaff } from "@/lib/auth/current-staff";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { resendSignupEmail } from "@/lib/recurring/resend-signup";

/**
 * POST /api/dd-migration/targets/[id]/signup-link — mint a fresh GoCardless
 * signup link for the target's plan WITHOUT emailing the customer. The
 * finance officer pastes it into a personal email from accounts@ (Mitchell's
 * rule: no automated invitations). Links expire in ~7 days, so this is
 * always minted on demand, never stored on the target.
 *
 * Needs a plan: the link is a Billing Request Flow against the plan's
 * billing request. If the site has no draft/pending plan yet, 409 with the
 * wizard URL so the UI can send them there.
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const staff = await getCurrentStaff();
  if (!staff) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  if (!(await currentUserHasPermission("invoices.manage_recurring"))) {
    return NextResponse.json({ error: "No permission" }, { status: 403 });
  }

  const svc = createServiceRoleClient();
  const { data: target } = await svc
    .from("dd_migration_targets")
    .select("id, status, site_id, recurring_plan_id")
    .eq("id", id)
    .maybeSingle();
  if (!target) return NextResponse.json({ error: "Target not found" }, { status: 404 });
  if (!["todo", "invited", "mandate_pending"].includes(target.status)) {
    return NextResponse.json({ error: `No signup link for a target that is ${target.status}` }, { status: 400 });
  }

  // Prefer the linked plan; otherwise the newest unsigned plan on the site.
  let planId: string | null = target.recurring_plan_id;
  if (!planId && target.site_id) {
    const { data: plan } = await svc
      .from("recurring_plans")
      .select("id")
      .eq("site_id", target.site_id)
      .in("status", ["draft", "pending_mandate"])
      .is("gc_mandate_id", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    planId = plan?.id ?? null;
  }
  if (!planId) {
    return NextResponse.json(
      {
        error: "Create the recurring plan for this site first — the signup link comes from it.",
        wizardUrl: target.site_id ? `/invoices/recurring/new?site=${target.site_id}` : null,
      },
      { status: 409 },
    );
  }

  try {
    const { signupUrl } = await resendSignupEmail(svc, planId, { reminder: false, send: false });
    if (target.recurring_plan_id !== planId) {
      await svc.from("dd_migration_targets").update({ recurring_plan_id: planId }).eq("id", id);
    }
    return NextResponse.json({ ok: true, url: signupUrl, planId });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Could not mint a signup link" },
      { status: 500 },
    );
  }
}
