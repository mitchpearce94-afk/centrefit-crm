import { NextRequest } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { cortexGate, ok, bad } from "@/lib/cortex-api/auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/cortex/suggestions?status=new|done&staff=sue&limit=
 * The CRM lightbulb queue, read-only (Mark, 14 Oct 2026: "what's outstanding,
 * by staff"). `status` defaults to open (`new`); `all` returns everything.
 */
export async function GET(req: NextRequest) {
  const denied = cortexGate(req);
  if (denied) return denied;
  const db = createServiceRoleClient();
  const p = req.nextUrl.searchParams;
  const status = (p.get("status") ?? "new").trim().toLowerCase();
  const staff = (p.get("staff") ?? "").trim().toLowerCase();
  const limit = Math.min(Math.max(Number(p.get("limit") ?? 100) || 100, 1), 500);

  let q = db
    .from("staff_suggestions")
    .select("id, created_at, updated_at, staff_name, staff_email, category, body, status, notes")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (status !== "all") q = q.eq("status", status);
  const { data, error } = await q;
  if (error) return bad(error.message, 500);
  let rows = (data ?? []).map((r) => ({
    ref: r.id.slice(0, 8).toUpperCase(),
    id: r.id,
    submitted_at: r.created_at,
    submitted_by: r.staff_name,
    submitted_by_email: r.staff_email,
    category: r.category,
    text: r.body,
    status: r.status,
    resolution_note: r.notes,
    resolved_at: r.status === "new" ? null : r.updated_at,
  }));
  if (staff) rows = rows.filter((r) => (r.submitted_by ?? "").toLowerCase().includes(staff) || (r.submitted_by_email ?? "").toLowerCase().includes(staff));
  return ok({ count: rows.length, status, suggestions: rows });
}
