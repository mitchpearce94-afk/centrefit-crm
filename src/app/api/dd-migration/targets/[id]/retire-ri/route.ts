import { NextRequest, NextResponse } from "next/server";
import { currentUserHasPermission } from "@/lib/auth/permissions";
import { getCurrentStaff } from "@/lib/auth/current-staff";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { getAuthedClient } from "@/lib/xero/client";
import { cancelRepeatingInvoice, getRepeatingInvoice } from "@/lib/xero/repeating-invoices";

/**
 * POST /api/dd-migration/targets/[id]/retire-ri — the RI swap's second half.
 * Once the customer's CRM plan is active (its own DD-themed RI + GC
 * subscription exist), the legacy Xero repeating invoice is redundant and
 * would invoice them twice. This deletes it in Xero — explicit, confirmed,
 * scoped to the one RI id the caller echoes back. Never automatic: the
 * June–July 2026 RI-swap incident is why.
 */
export const maxDuration = 60;

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const staff = await getCurrentStaff();
  if (!staff) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  if (!(await currentUserHasPermission("invoices.manage_recurring"))) {
    return NextResponse.json({ error: "No permission" }, { status: 403 });
  }
  const body = (await req.json().catch(() => ({}))) as { confirmRiId?: string };

  const svc = createServiceRoleClient();
  const { data: target } = await svc
    .from("dd_migration_targets")
    .select("id, status, xero_repeating_invoice_id, xero_contact_name, recurring_plan_id, ri_total")
    .eq("id", id)
    .maybeSingle();
  if (!target) return NextResponse.json({ error: "Target not found" }, { status: 404 });
  if (target.status !== "dd_live") {
    return NextResponse.json({ error: "Only a target whose direct debit is live can have its legacy RI retired" }, { status: 400 });
  }
  const riId = target.xero_repeating_invoice_id;
  if (!riId || body.confirmRiId !== riId) {
    return NextResponse.json({ error: "Confirmation did not match the repeating invoice id" }, { status: 400 });
  }
  if (!target.recurring_plan_id) {
    return NextResponse.json({ error: "No replacement plan linked — nothing to retire against" }, { status: 400 });
  }
  const { data: plan } = await svc
    .from("recurring_plans")
    .select("id, status, gc_mandate_id, gc_subscription_id, xero_repeating_invoice_id")
    .eq("id", target.recurring_plan_id)
    .maybeSingle();
  if (!plan || plan.status !== "active" || !plan.gc_mandate_id || !plan.xero_repeating_invoice_id) {
    return NextResponse.json(
      { error: "Replacement plan isn't fully active yet (needs mandate + its own repeating invoice). Wait for activation before retiring the legacy RI." },
      { status: 409 },
    );
  }
  if (plan.xero_repeating_invoice_id === riId) {
    return NextResponse.json({ error: "That repeating invoice belongs to the replacement plan — refusing" }, { status: 400 });
  }

  try {
    const { client: xero, conn } = await getAuthedClient(svc);
    const state = await getRepeatingInvoice(xero, conn.tenant_id, riId);
    if (String(state.status) !== "AUTHORISED") {
      await svc
        .from("dd_migration_targets")
        .update({ status: "ri_retired", ri_retired_at: new Date().toISOString(), xero_ri_status: String(state.status) })
        .eq("id", id);
      return NextResponse.json({ ok: true, alreadyRetired: true });
    }
    await cancelRepeatingInvoice(xero, conn.tenant_id, riId);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Xero refused the change" },
      { status: 502 },
    );
  }

  const now = new Date().toISOString();
  await svc
    .from("dd_migration_targets")
    .update({ status: "ri_retired", ri_retired_at: now, xero_ri_status: "DELETED", status_reason: null })
    .eq("id", id);
  await svc.from("dd_migration_touches").insert({
    target_id: id,
    staff_id: staff.id,
    channel: "system",
    note: `Legacy repeating invoice ${riId} ($${Number(target.ri_total ?? 0).toFixed(2)}) retired in Xero by ${staff.display_name}`,
  });
  return NextResponse.json({ ok: true });
}
