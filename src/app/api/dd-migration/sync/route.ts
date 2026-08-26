import { NextResponse } from "next/server";
import { currentUserHasPermission } from "@/lib/auth/permissions";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { syncDdMigrationTargets } from "@/lib/recurring/dd-migration";

/**
 * POST /api/dd-migration/sync — pull the legacy repeating-invoice list from
 * Xero and refresh the tracker. Manual "Sync from Xero" button; the weekly
 * cron (/api/cron/dd-migration-sync) does the same on a schedule.
 */
export const maxDuration = 300;

export async function POST() {
  if (!(await currentUserHasPermission("invoices.manage_recurring"))) {
    return NextResponse.json({ error: "No permission" }, { status: 403 });
  }
  try {
    const result = await syncDdMigrationTargets(createServiceRoleClient());
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    console.error("[dd-migration/sync]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Sync failed" },
      { status: 500 },
    );
  }
}
