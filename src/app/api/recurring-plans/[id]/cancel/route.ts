import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { cancelMandate } from "@/lib/gocardless/client";
import { getAuthedClient } from "@/lib/xero/client";
import { cancelRepeatingInvoice } from "@/lib/xero/repeating-invoices";

/**
 * POST /api/recurring-plans/[id]/cancel
 *
 * Behaviour depends on the plan's current status:
 *
 * - `pending_mandate` / `failed`:
 *     No GC mandate exists yet. Hard-delete the plan row + cascade items.
 *     If a Billing Request was created (gc_billing_request_id set), GC will
 *     auto-expire it — we don't bother calling cancel because the BR isn't
 *     fulfilled and won't pull funds either way.
 *
 * - `active` / `paused`:
 *     Real money is at risk. Cancel the GC mandate (stops future debits),
 *     mark the Xero RepeatingInvoice template(s) DELETED (stops future
 *     auto-generated invoices), then SOFT-cancel the plan: status='cancelled',
 *     row preserved for audit / accounting reconciliation.
 *
 * - `cancelled`:
 *     No-op. Already cancelled.
 *
 * Errors during the GC or Xero step leave the plan in 'cancelled' anyway
 * if at least the GC mandate was cancelled (no-future-debits guarantee).
 * Operator can manually clean up Xero from the dashboard if needed.
 */
export async function POST(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });

  const { data: plan, error: planErr } = await supabase
    .from("recurring_plans")
    .select("id, status, gc_mandate_id, xero_repeating_invoice_id, xero_repeating_invoice_secondary_id")
    .eq("id", id)
    .maybeSingle();
  if (planErr || !plan) {
    return NextResponse.json({ error: "Plan not found" }, { status: 404 });
  }

  if (plan.status === "cancelled") {
    return NextResponse.json({ status: "already_cancelled" });
  }

  // Pending / failed → hard delete. Items cascade.
  if (plan.status === "pending_mandate" || plan.status === "failed") {
    const { error } = await supabase.from("recurring_plans").delete().eq("id", id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ status: "deleted" });
  }

  // Active / paused → cancel mandate + Xero RIs + soft cancel.
  const errors: string[] = [];

  if (plan.gc_mandate_id) {
    try {
      await cancelMandate(plan.gc_mandate_id);
    } catch (err) {
      errors.push(`GC mandate cancel: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  const riIds = [plan.xero_repeating_invoice_id, plan.xero_repeating_invoice_secondary_id].filter(Boolean) as string[];
  if (riIds.length > 0) {
    try {
      const { client, conn } = await getAuthedClient();
      for (const riId of riIds) {
        try {
          await cancelRepeatingInvoice(client, conn.tenant_id, riId);
        } catch (err) {
          errors.push(`Xero RI ${riId.slice(0, 8)}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
    } catch (err) {
      errors.push(`Xero auth: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  const { error: updErr } = await supabase
    .from("recurring_plans")
    .update({
      status: "cancelled",
      notes: errors.length > 0 ? `Cancelled with errors: ${errors.join("; ")}`.slice(0, 1000) : null,
    })
    .eq("id", id);
  if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 });

  return NextResponse.json({
    status: "cancelled",
    warnings: errors.length > 0 ? errors : undefined,
  });
}
