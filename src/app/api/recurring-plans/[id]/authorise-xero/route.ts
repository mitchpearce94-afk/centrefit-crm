import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getAuthedClient } from "@/lib/xero/client";
import { authoriseRepeatingInvoice } from "@/lib/xero/repeating-invoices";

/**
 * POST /api/recurring-plans/[id]/authorise-xero
 *
 * Flips the plan's Xero RepeatingInvoice template(s) from DRAFT to
 * AUTHORISED. This is the action that makes Xero start generating + auto-
 * emailing the child invoices on schedule.
 *
 * ⚠ CUSTOMER-FACING: once authorised, the next scheduled run will email
 * the customer. Admin-only and intentionally explicit (no batch endpoint,
 * one plan at a time, button confirms before posting).
 */
export async function POST(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });

  // Admin-only — matches the existing post-incident hard rule on customer-
  // facing Xero actions.
  const { data: me } = await supabase
    .from("staff")
    .select("role")
    .eq("id", user.id)
    .single();
  if (me?.role !== "admin") {
    return NextResponse.json({ error: "Admin only" }, { status: 403 });
  }

  const { data: plan, error } = await supabase
    .from("recurring_plans")
    .select("id, status, xero_repeating_invoice_id, xero_repeating_invoice_secondary_id")
    .eq("id", id)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!plan) return NextResponse.json({ error: "Plan not found" }, { status: 404 });
  if (plan.status !== "active") {
    return NextResponse.json(
      { error: `Plan status is ${plan.status} — only active plans can have their Xero template authorised.` },
      { status: 400 },
    );
  }
  const ids = [plan.xero_repeating_invoice_id, plan.xero_repeating_invoice_secondary_id]
    .filter((x): x is string => !!x);
  if (ids.length === 0) {
    return NextResponse.json(
      { error: "Plan has no Xero RepeatingInvoice template attached." },
      { status: 400 },
    );
  }

  let xero, tenantId;
  try {
    const auth = await getAuthedClient(supabase);
    xero = auth.client;
    tenantId = auth.conn.tenant_id;
  } catch (e) {
    return NextResponse.json(
      { error: `Xero auth failed: ${e instanceof Error ? e.message : String(e)}` },
      { status: 502 },
    );
  }

  // Sequentialise to dodge Xero's concurrent rate limit.
  const results: Array<{ id: string; status: string; nextScheduledDate: string | null }> = [];
  for (const riId of ids) {
    try {
      const state = await authoriseRepeatingInvoice(xero, tenantId, riId);
      results.push({
        id: riId,
        status: state.status,
        nextScheduledDate: state.nextScheduledDate,
      });
    } catch (e) {
      return NextResponse.json(
        {
          error: `Xero update failed for ${riId}: ${e instanceof Error ? e.message : String(e)}`,
          partial: results,
        },
        { status: 502 },
      );
    }
  }

  return NextResponse.json({
    ok: true,
    planId: id,
    templates: results,
  });
}
