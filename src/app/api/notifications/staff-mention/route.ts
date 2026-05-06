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

  // For plan mentions, attach the plan's exported PDF so the recipient
  // sees the actual drawings in their inbox — not just a link.
  let attachments: { filename: string; content: Buffer }[] | undefined;
  if (refType === "plan") {
    const { data: plan } = await supabase
      .from("plan_files")
      .select("pdf_url, state, client_name, site_name, revision")
      .eq("id", refId)
      .maybeSingle();
    if (plan?.pdf_url) {
      try {
        const res = await fetch(plan.pdf_url);
        if (res.ok) {
          const buf = Buffer.from(await res.arrayBuffer());
          const safeBase = [plan.state, plan.client_name, plan.site_name, plan.revision ? `Rev ${plan.revision}` : null]
            .filter(Boolean)
            .join(" - ")
            .replace(/[^a-zA-Z0-9\-_ ]/g, "")
            .trim() || "plan";
          attachments = [{ filename: `${safeBase}.pdf`, content: buf }];
        } else {
          console.warn(`[staff-mention] couldn't fetch plan PDF for ${refId}: HTTP ${res.status}`);
        }
      } catch (err) {
        console.warn(`[staff-mention] couldn't fetch plan PDF for ${refId}:`, err);
      }
    }
  }

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
    attachments,
  });

  return NextResponse.json({ ok: true, count: staffIds.length, attachedPdf: Boolean(attachments) });
}
