import { NextRequest, NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { activatePlan } from "@/lib/recurring/activate-plan";

/**
 * Daily — re-run activatePlan on plans that signed a mandate (so
 * gc_mandate_id is populated) but never made it to `active` because the
 * original BR.fulfilled webhook trip through activatePlan failed (Xero
 * rate-limit, token refresh blip, RI creation error).
 *
 * Without this cron, a single transient Xero hiccup means the plan stays
 * in pending_mandate forever — that's the silent-failure mode that bit
 * Ben Gunning / Snap Fitness Woodend on 2026-05-25 (BR.fulfilled wrote
 * the GC IDs, activatePlan threw on the Xero step, console.error went
 * to function logs nobody reads).
 *
 * Hobby plan caps cron jobs at once-daily, so this runs nightly. The
 * immediate-recovery path is the "Retry now" button on the plan detail
 * page — the cron is a safety net for plans Mitchell didn't notice
 * (notification was missed, plan was created late at night, etc).
 *
 * Eligibility:
 *   - status = pending_mandate (live plans aren't retried)
 *   - gc_mandate_id IS NOT NULL (we need a mandate to bill against)
 *   - activation_attempts < 10 (bail after persistent failure — Mitchell
 *     already has the notification from each attempt)
 *   - last_activation_attempt_at IS NULL or older than the backoff window
 *     for the current attempt count (24h floor on Hobby).
 *
 * Auth: X-Cf-Cron-Secret matches CRON_SECRET (same pattern as
 * quote-followups). Vercel cron forwards the header automatically.
 */

const MAX_ATTEMPTS = 10;

// Backoff schedule in minutes. Earlier attempts retry quickly so a
// transient blip resolves on its own; later attempts back off so a
// genuinely broken plan doesn't burn Xero quota.
const BACKOFF_MINUTES = [1, 5, 15, 60, 240, 720, 1440, 1440, 1440, 1440];

function backoffFor(attempt: number): number {
  if (attempt <= 0) return 0;
  return BACKOFF_MINUTES[Math.min(attempt - 1, BACKOFF_MINUTES.length - 1)];
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
  const { data: stuck, error } = await supabase
    .from("recurring_plans")
    .select(
      "id, activation_attempts, last_activation_attempt_at, activation_error",
    )
    .eq("status", "pending_mandate")
    .not("gc_mandate_id", "is", null)
    .lt("activation_attempts", MAX_ATTEMPTS)
    .order("last_activation_attempt_at", { ascending: true, nullsFirst: true })
    .limit(20);

  if (error) {
    return NextResponse.json(
      { error: `Failed to query stuck plans: ${error.message}` },
      { status: 500 },
    );
  }

  const now = Date.now();
  const eligible = (stuck ?? []).filter((p) => {
    const attempts = p.activation_attempts ?? 0;
    const waitMs = backoffFor(attempts) * 60_000;
    if (!p.last_activation_attempt_at) return true;
    return now - new Date(p.last_activation_attempt_at).getTime() >= waitMs;
  });

  const results: Array<{ planId: string; ok: boolean; reason?: string }> = [];
  for (const plan of eligible) {
    try {
      const r = await activatePlan(supabase, plan.id);
      if (r.ok) {
        results.push({ planId: plan.id, ok: true });
      } else {
        results.push({ planId: plan.id, ok: false, reason: r.reason });
      }
    } catch (err) {
      // activatePlan now records errors internally, but defensive log just
      // in case the catch path itself throws.
      const message = err instanceof Error ? err.message : String(err);
      results.push({ planId: plan.id, ok: false, reason: `cron_caught: ${message}` });
    }
  }

  return NextResponse.json({
    scanned: stuck?.length ?? 0,
    eligible: eligible.length,
    results,
  });
}
