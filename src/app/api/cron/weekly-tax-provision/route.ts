import { NextRequest, NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { brisbaneDateISO } from "@/lib/dates";
import { computeCashTaxProvision } from "@/lib/xero/cash-tax-provision";
import { sendWeeklyTaxProvisionEmail } from "@/lib/emails/weekly-tax-provision";

/**
 * Friday 3pm Brisbane (05:00 UTC Fri) — weekly tax set-aside brief for
 * Mitchell (2026-08-28). Cash-basis GST + estimated company tax from live
 * Xero data.
 *
 * The park recommendation is CATCH-UP based: each run recomputes the
 * quarter-to-date target fresh (so bank-rec lag self-corrects — payments
 * reconciled late backfill with their real dates) and recommends
 * target − what previous runs already recommended. A week that
 * under-reports because the rec is behind simply shifts its park into the
 * next week's number.
 *
 * INTERIM: retire this cron (vercel.json + this route) once the accountant
 * starts. Auth: X-Cf-Cron-Secret / Bearer matches CRON_SECRET.
 */

export const maxDuration = 300;

const OWNER_EMAIL = "mitchell@centrefit.com.au";

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

  const svc = createServiceRoleClient();
  try {
    const provision = await computeCashTaxProvision(svc);

    const { data: prevRuns } = await svc
      .from("tax_provision_runs")
      .select("park_recommended")
      .eq("quarter_start", provision.quarter.start);
    const alreadyParked = (prevRuns ?? []).reduce(
      (a, r) => a + Number(r.park_recommended ?? 0),
      0,
    );
    const park = Math.max(0, provision.quarter.target - alreadyParked);

    await svc.from("tax_provision_runs").insert({
      run_date: brisbaneDateISO(new Date()),
      quarter_start: provision.quarter.start,
      qtd_cash_in: provision.quarter.cashIn.toFixed(2),
      qtd_cash_out: provision.quarter.cashOut.toFixed(2),
      qtd_gst_net: provision.quarter.gstNet.toFixed(2),
      qtd_income_tax: provision.quarter.incomeTax.toFixed(2),
      qtd_target: provision.quarter.target.toFixed(2),
      park_recommended: park.toFixed(2),
    });

    const sent = await sendWeeklyTaxProvisionEmail(OWNER_EMAIL, provision, {
      park,
      alreadyParked,
    });
    if (!sent.ok) {
      return NextResponse.json(
        { error: `Computed but email failed: ${sent.error}` },
        { status: 500 },
      );
    }
    return NextResponse.json({
      ok: true,
      week: `${provision.weekStart} → ${provision.weekEnd}`,
      park: Math.round(park),
      qtdTarget: Math.round(provision.quarter.target),
      alreadyParked: Math.round(alreadyParked),
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to compute tax provision" },
      { status: 500 },
    );
  }
}
