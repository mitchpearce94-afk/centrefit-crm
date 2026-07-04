import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { startRemandate } from "@/lib/recurring/remandate";

/**
 * POST /api/recurring-plans/[id]/remandate — send (or re-send) the new-owner
 * DD signup for a plan whose site changed hands (site-first D4). Admin only,
 * same gate as change-owner: this emails a customer and rearranges billing.
 *
 * Idempotent-friendly: while a signup is pending the SAME link is re-emailed;
 * no duplicate billing requests are created.
 */
export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const { data: staffRow } = await supabase.from("staff").select("role").eq("id", user.id).maybeSingle();
  if (staffRow?.role !== "admin") return NextResponse.json({ error: "Admin only" }, { status: 403 });

  const svc = createServiceRoleClient();
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? new URL(req.url).origin;
  const result = await startRemandate(svc, id, { appUrl });
  if (!result.ok) return NextResponse.json({ error: result.reason }, { status: 400 });
  return NextResponse.json({
    ok: true,
    signupUrl: result.signupUrl,
    emailedTo: result.emailedTo,
    resent: result.resent,
  });
}
