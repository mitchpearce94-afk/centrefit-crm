import { NextRequest, NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { enqueueNotification } from "@/lib/notifications/enqueue";
import { brisbaneDateISO } from "@/lib/dates";

/**
 * Daily — surface recurring plans whose customer NEVER SIGNED the mandate.
 *
 * The cost leak (Mitchell, 2026-07-09): Centrefit starts paying for the
 * underlying services (NBN wholesale, SIMs, monitoring) as soon as the plan
 * is provisioned, but until the customer signs, no invoice ever gets created
 * and nothing is collected. retry-stuck-mandates only covers plans that
 * SIGNED but failed activation — this watchdog covers the never-signed.
 *
 * Eligibility: status = pending_mandate, no gc_mandate_id, older than the
 * grace window. Fires ONE summary notification per run (daily nag until the
 * list is empty — that's the point), listing each plan with its age and
 * monthly value, flagging any whose chosen first-invoice date has already
 * passed.
 *
 * Deliberately does NOT email customers — chasing the customer stays a
 * human decision (resend from the plan page). Staff-facing only.
 *
 * Auth: X-Cf-Cron-Secret matches CRON_SECRET.
 */

const GRACE_DAYS = 3;

interface PendingPlan {
  id: string;
  created_at: string;
  first_invoice_date: string | null;
  customers: { name: string } | { name: string }[] | null;
  customer_sites: { name: string } | { name: string }[] | null;
  recurring_plan_items: Array<{
    price_inc_gst: number | string;
    frequency: string;
    quantity: number | null;
  }>;
}

function monthlyValue(p: PendingPlan): number {
  return (p.recurring_plan_items ?? []).reduce((sum, it) => {
    const factor = it.frequency === "yearly" ? 1 / 12 : it.frequency === "quarterly" ? 1 / 3 : 1;
    return sum + Number(it.price_inc_gst) * (it.quantity ?? 1) * factor;
  }, 0);
}

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const provided =
    req.headers.get("x-cf-cron-secret") ??
    req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!secret) {
    return NextResponse.json({ error: "CRON_SECRET not configured" }, { status: 500 });
  }
  if (provided !== secret) {
    return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  }

  const supabase = createServiceRoleClient();
  const cutoff = new Date(Date.now() - GRACE_DAYS * 86_400_000).toISOString();

  const { data, error } = await supabase
    .from("recurring_plans")
    .select(`
      id, created_at, first_invoice_date,
      customers(name), customer_sites(name),
      recurring_plan_items(price_inc_gst, frequency, quantity)
    `)
    .eq("status", "pending_mandate")
    .is("gc_mandate_id", null)
    .lt("created_at", cutoff)
    .order("created_at", { ascending: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const plans = (data ?? []) as unknown as PendingPlan[];
  if (plans.length === 0) {
    return NextResponse.json({ ok: true, pending: 0 });
  }

  const todayStr = brisbaneDateISO(new Date());
  const lines = plans.map((p) => {
    const customer = Array.isArray(p.customers) ? p.customers[0] : p.customers;
    const site = Array.isArray(p.customer_sites) ? p.customer_sites[0] : p.customer_sites;
    const who = site?.name ?? customer?.name ?? "Unknown";
    const days = Math.floor((Date.now() - new Date(p.created_at).getTime()) / 86_400_000);
    const overdueStart = p.first_invoice_date && p.first_invoice_date < todayStr;
    return `${who}: $${monthlyValue(p).toFixed(2)}/mo unsigned for ${days}d${
      overdueStart ? " ⚠ start date passed" : ""
    }`;
  });
  const totalMonthly = plans.reduce((s, p) => s + monthlyValue(p), 0);

  await enqueueNotification({
    supabase,
    typeCode: "billing.gap",
    refType: "recurring_plan",
    refId: plans[0].id,
    audience: { allActive: true },
    title: `${plans.length} unsigned mandate${plans.length === 1 ? "" : "s"} — $${totalMonthly.toFixed(2)}/mo not being collected`,
    body: `We're paying for these services with no invoice behind them. ${lines.join(" · ")}. Chase the signup or cancel the plan.`,
    href: "/invoices/recurring?tab=pending",
  });

  return NextResponse.json({
    ok: true,
    pending: plans.length,
    monthlyAtStake: Math.round(totalMonthly * 100) / 100,
  });
}
