import { NextRequest, NextResponse } from "next/server";
import { financeViewerOrNull } from "@/lib/finance/access";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { audit } from "@/lib/finance/audit";

const MODES = new Set(["off", "dry_run", "live"]);

/** Settings → Finance (D4). Only the owner can change viewers or flip a job to live. */
export async function POST(req: NextRequest) {
  const viewer = await financeViewerOrNull();
  if (!viewer) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const patch: Record<string, unknown> = {};
  for (const k of ["gc_payouts_mode", "stripe_verify_mode", "draft_bills_mode"] as const) {
    if (typeof body[k] === "string" && MODES.has(body[k] as string)) {
      if (body[k] === "live" && !viewer.isOwner) return NextResponse.json({ error: "Only Mitchell can switch a job live" }, { status: 403 });
      patch[k] = body[k];
    }
  }
  if (typeof body.paused === "boolean") patch.paused = body.paused;
  for (const k of ["bank_account_code", "fee_account_code", "fee_tax_type", "fee_contact_name"] as const) {
    if (typeof body[k] === "string" && (body[k] as string).trim()) patch[k] = (body[k] as string).trim();
  }
  if (typeof body.match_window_days === "number" && body.match_window_days >= 1 && body.match_window_days <= 90) patch.match_window_days = body.match_window_days;
  if (typeof body.xero_day_floor === "number" && body.xero_day_floor >= 0 && body.xero_day_floor <= 5000) patch.xero_day_floor = body.xero_day_floor;
  if (typeof body.ingest_since === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.ingest_since)) patch.ingest_since = body.ingest_since;
  if (Array.isArray(body.viewer_staff_ids)) {
    if (!viewer.isOwner) return NextResponse.json({ error: "Only Mitchell can change who sees Finance" }, { status: 403 });
    patch.viewer_staff_ids = (body.viewer_staff_ids as unknown[]).filter((v) => typeof v === "string");
  }
  if (!Object.keys(patch).length) return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  const svc = createServiceRoleClient();
  const { data: before } = await svc.from("finance_settings").select("*").eq("id", 1).single();
  const { error } = await svc.from("finance_settings").update({ ...patch, updated_at: new Date().toISOString(), updated_by: viewer.userId }).eq("id", 1);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  await audit(svc, { actor: viewer.email, action: "settings.updated", entity: "finance_settings", entityId: "1", before: Object.fromEntries(Object.keys(patch).map((k) => [k, before?.[k]])), after: patch, rule: "D4" });
  return NextResponse.json({ ok: true });
}
