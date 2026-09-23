import { NextResponse } from "next/server";
import { financeViewerOrNull } from "@/lib/finance/access";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { runFinanceCycle } from "@/lib/finance/run";
import { audit } from "@/lib/finance/audit";

export const maxDuration = 300;

/** "Run now" from Settings → Finance. Same cycle as the cron (D4). */
export async function POST() {
  const viewer = await financeViewerOrNull();
  if (!viewer) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const svc = createServiceRoleClient();
  await audit(svc, { actor: viewer.email, action: "cycle.requested", rule: "D4" });
  const report = await runFinanceCycle(svc, `manual:${viewer.email}`);
  return NextResponse.json({ ok: report.errors.length === 0, report });
}
