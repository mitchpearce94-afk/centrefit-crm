import { NextRequest } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { cortexGate, ok, bad } from "@/lib/cortex-api/auth";
import { one } from "@/lib/cortex-api/jobs";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/cortex/quotes?q=&status=&limit=
 * Quotes with SELL totals only (pricing_snapshot->>totalExGST) — cost, margin
 * and supplier data never leave the database (same rail as /api/stats/daily).
 */
export async function GET(req: NextRequest) {
  const denied = cortexGate(req);
  if (denied) return denied;
  const p = req.nextUrl.searchParams;
  const q = (p.get("q") ?? "").trim();
  const status = (p.get("status") ?? "").trim();
  const limit = Math.min(Math.max(Number(p.get("limit") ?? 25) || 25, 1), 50);
  const db = createServiceRoleClient();
  let query = db
    .from("quotes")
    .select("ref, client_name, site_name, site_address, status, quote_type, sent_at, accepted_at, declined_at, expires_at, followup_count, created_at, total:pricing_snapshot->>totalExGST, job:jobs(number)")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (q) {
    const like = `%${q}%`;
    query = query.or(`ref.ilike.${like},client_name.ilike.${like},site_name.ilike.${like}`);
  }
  if (status) query = query.eq("status", status);
  const { data, error } = await query;
  if (error) return bad(error.message, 500);
  return ok({
    count: (data ?? []).length,
    quotes: (data ?? []).map((r) => ({
      ref: r.ref, client: r.client_name, site: r.site_name, site_address: r.site_address, status: r.status, type: r.quote_type,
      total_ex_gst: r.total != null ? Number(r.total) : null,
      sent_at: r.sent_at, accepted_at: r.accepted_at, declined_at: r.declined_at, expires_at: r.expires_at, followups: r.followup_count,
      job: one(r.job as { number: string } | { number: string }[] | null)?.number ?? null, created_at: r.created_at,
    })),
  });
}
