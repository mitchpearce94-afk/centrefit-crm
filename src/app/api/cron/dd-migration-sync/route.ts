import { NextRequest, NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { syncDdMigrationTargets } from "@/lib/recurring/dd-migration";

/**
 * GET /api/cron/dd-migration-sync — weekly (Sun 20:00 UTC = Mon 06:00 AEST)
 * refresh of the direct-debit migration tracker from Xero, so the finance
 * officer's Tuesday batch works off a current list.
 *
 * Auth: X-Cf-Cron-Secret (or Bearer) matches CRON_SECRET.
 */
export const maxDuration = 300;

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
  try {
    const result = await syncDdMigrationTargets(createServiceRoleClient());
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    console.error("[cron/dd-migration-sync]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Sync failed" },
      { status: 500 },
    );
  }
}
