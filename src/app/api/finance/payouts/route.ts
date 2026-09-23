import { NextRequest, NextResponse } from "next/server";
import { financeViewerOrNull } from "@/lib/finance/access";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { audit } from "@/lib/finance/audit";
import { buildMatchContext, loadSettings, matchPayout, planPayout, postPayout } from "@/lib/finance/gc-payouts";
import { openXero } from "@/lib/finance/xero-rest";

export const maxDuration = 120;

/**
 * Per-payout actions:
 *   { id, action: "rematch" }         — re-run match + plan for one payout
 *   { id, action: "post" }            — post THIS payout now (live mode only, D2/D4)
 *   { id, action: "mark_reconciled" } — Mitchell did it by hand
 */
export async function POST(req: NextRequest) {
  const viewer = await financeViewerOrNull();
  if (!viewer) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const id = String(body.id ?? "");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  const svc = createServiceRoleClient();
  const settings = await loadSettings(svc);
  try {
    if (body.action === "rematch") {
      const ctx = await buildMatchContext(svc, settings.match_window_days);
      const m = await matchPayout(svc, id, ctx);
      const { status } = await planPayout(svc, id, settings);
      return NextResponse.json({ ok: true, matched: m, status });
    }
    if (body.action === "post") {
      if (settings.gc_payouts_mode !== "live" || settings.paused) return NextResponse.json({ error: "GoCardless payouts are not live (Settings → Finance)" }, { status: 409 });
      if (!viewer.isOwner) return NextResponse.json({ error: "Only Mitchell can post" }, { status: 403 });
      const x = await openXero(svc);
      const r = await postPayout(svc, x, id);
      await audit(svc, { actor: viewer.email, action: "payout.post_requested", entity: "finance_payouts", entityId: id, after: r, rule: "D2" });
      return NextResponse.json(r, { status: r.ok ? 200 : 409 });
    }
    if (body.action === "mark_reconciled") {
      const { data: before } = await svc.from("finance_payouts").select("status").eq("id", id).single();
      await svc.from("finance_payouts").update({ status: "reconciled", reconciled_at: new Date().toISOString(), exception: null, updated_at: new Date().toISOString() }).eq("id", id);
      await svc.from("finance_review_items").update({ status: "resolved", resolution: { by: viewer.email, reason: "payout marked reconciled by hand" }, resolved_at: new Date().toISOString() }).eq("payout_id", id).eq("status", "open");
      await audit(svc, { actor: viewer.email, action: "payout.marked_reconciled", entity: "finance_payouts", entityId: id, before, after: { status: "reconciled" }, rule: "D10" });
      return NextResponse.json({ ok: true });
    }
    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
