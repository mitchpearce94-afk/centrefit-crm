import { NextRequest, NextResponse } from "next/server";
import { currentUserHasPermission } from "@/lib/auth/permissions";
import { getCurrentStaff } from "@/lib/auth/current-staff";
import { createServiceRoleClient } from "@/lib/supabase/service";

/**
 * POST /api/dd-migration/targets/[id]/touch — log a contact with the
 * customer. { channel: "email" | "note", note?: string, markInvited?: boolean }
 * An email touch on a To-do target moves it to Invited (and stamps
 * invited_at once); every touch bumps touch_count / last_touch_at so the
 * weekly "sent" figure is a straight count of email touches.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const staff = await getCurrentStaff();
  if (!staff) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  if (!(await currentUserHasPermission("invoices.manage_recurring"))) {
    return NextResponse.json({ error: "No permission" }, { status: 403 });
  }

  const body = (await req.json().catch(() => ({}))) as { channel?: string; note?: string; markInvited?: boolean };
  const channel = body.channel === "note" ? "note" : "email";
  const note = typeof body.note === "string" ? body.note.trim().slice(0, 1000) || null : null;
  const markInvited = body.markInvited ?? channel === "email";

  const svc = createServiceRoleClient();
  const { data: target } = await svc
    .from("dd_migration_targets")
    .select("id, status, invited_at, touch_count")
    .eq("id", id)
    .maybeSingle();
  if (!target) return NextResponse.json({ error: "Target not found" }, { status: 404 });

  const { error: touchErr } = await svc.from("dd_migration_touches").insert({
    target_id: id,
    staff_id: staff.id,
    channel,
    note,
  });
  if (touchErr) return NextResponse.json({ error: touchErr.message }, { status: 500 });

  const now = new Date().toISOString();
  const patch: Record<string, unknown> = {
    last_touch_at: now,
    touch_count: (target.touch_count ?? 0) + 1,
  };
  if (markInvited && (target.status === "todo" || target.status === "invited")) {
    patch.status = "invited";
    if (!target.invited_at) patch.invited_at = now;
  }
  const { error } = await svc.from("dd_migration_targets").update(patch).eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true, status: patch.status ?? target.status });
}
