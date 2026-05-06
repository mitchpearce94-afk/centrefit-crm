import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { enqueueNotification } from "@/lib/notifications/enqueue";

const VALID_REF_TYPES = new Set(["plan", "quote", "invoice", "job", "recurring_plan"]);

/**
 * Direct staff mention — bypasses the staff_notification_preferences table
 * because it's a direct ping ("hey, look at this") rather than an event-
 * subscription notification. The 'staff.mention' notification type still
 * exists so users can suppress all mentions if they really want to, but
 * default_enabled is true.
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const { staffIds, refType, refId, refLabel, href, message } = body ?? {};

  if (!Array.isArray(staffIds) || staffIds.length === 0) {
    return NextResponse.json({ error: "staffIds must be a non-empty array" }, { status: 400 });
  }
  if (!refType || !VALID_REF_TYPES.has(refType)) {
    return NextResponse.json({ error: `refType must be one of ${[...VALID_REF_TYPES].join(", ")}` }, { status: 400 });
  }
  if (!refId || typeof refId !== "string") {
    return NextResponse.json({ error: "refId required" }, { status: 400 });
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const { data: meStaff } = await supabase
    .from("staff")
    .select("display_name")
    .eq("id", user.id)
    .maybeSingle();
  const senderName = meStaff?.display_name ?? "A teammate";

  const sanitizedMessage = typeof message === "string" && message.trim().length > 0
    ? message.trim().slice(0, 280)
    : null;

  const title = `${senderName} mentioned you`;
  const bodyText = sanitizedMessage
    ? `${refLabel ?? ""} — ${sanitizedMessage}`.trim().replace(/^—\s*/, "")
    : refLabel ?? "Tap to view";

  await enqueueNotification({
    supabase,
    typeCode: "staff.mention",
    refType,
    refId,
    audience: { staffIds: staffIds as string[] },
    title,
    body: bodyText,
    href: typeof href === "string" ? href : undefined,
    metadata: {
      from_staff_id: user.id,
      from_staff_name: senderName,
      message: sanitizedMessage,
      ref_label: refLabel ?? null,
    },
  });

  return NextResponse.json({ ok: true, count: staffIds.length });
}
