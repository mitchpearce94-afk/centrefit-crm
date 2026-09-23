import { NextRequest, NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { runFinanceCycle } from "@/lib/finance/run";

/**
 * Finance agent daily cycle (docs/finance-CONTEXT.md, Schedule). 20:30 UTC =
 * 06:30 AEST, after overnight GoCardless payouts have landed. Mirror → ingest
 * → match → plan → (live) post → refresh reconciled → daily note.
 * Auth: X-Cf-Cron-Secret / Bearer matches CRON_SECRET.
 */
export const maxDuration = 300;
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const given = req.headers.get("x-cf-cron-secret") ?? req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!secret) return NextResponse.json({ error: "CRON_SECRET not configured" }, { status: 500 });
  if (given !== secret) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const svc = createServiceRoleClient();
  const report = await runFinanceCycle(svc, "cron");
  return NextResponse.json({ ok: report.errors.length === 0, report });
}
