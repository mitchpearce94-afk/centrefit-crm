import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Notification fan-out helper. Resolves the audience to staff IDs, checks
 * each staffer's preference (inheriting `notification_types.default_enabled`
 * if no override row exists), inserts notifications rows.
 *
 * Email send and push send are stubbed — Resend integration for
 * notifications is a follow-up. The bell + dropdown work today off the
 * notifications rows alone.
 *
 * Usage:
 *   await enqueueNotification({
 *     supabase,                      // service-role for webhooks
 *     typeCode: "quote.accepted",
 *     refType: "quote",
 *     refId: quote.id,
 *     audience: { staffId: quote.created_by },
 *     title: "Quote accepted",
 *     body: `${customerName} accepted ${quote.ref}`,
 *     href: `/quoting/${quote.id}`,
 *   });
 */

export type NotificationRefType = "quote" | "invoice" | "job" | "recurring_plan" | "enquiry" | "plan";

export type Audience =
  | { staffId: string | null | undefined }
  | { staffIds: string[] }
  | { role: string }                      // staff.role enum value
  | { allActive: true };

export interface EnqueueNotificationInput {
  supabase: SupabaseClient;
  typeCode: string;
  refType: NotificationRefType;
  refId: string;
  audience: Audience;
  title: string;
  body?: string;
  href?: string;
  metadata?: Record<string, unknown>;
}

async function resolveAudience(
  supabase: SupabaseClient,
  audience: Audience,
): Promise<string[]> {
  if ("staffId" in audience) {
    return audience.staffId ? [audience.staffId] : [];
  }
  if ("staffIds" in audience) {
    return audience.staffIds;
  }
  if ("role" in audience) {
    const { data } = await supabase
      .from("staff")
      .select("id")
      .eq("is_active", true)
      .eq("role", audience.role);
    return (data ?? []).map((r) => r.id as string);
  }
  // allActive
  const { data } = await supabase.from("staff").select("id").eq("is_active", true);
  return (data ?? []).map((r) => r.id as string);
}

export async function enqueueNotification(input: EnqueueNotificationInput): Promise<void> {
  const { supabase, typeCode, refType, refId, audience, title, body, href, metadata } = input;
  try {
    const targets = await resolveAudience(supabase, audience);
    if (targets.length === 0) return;

    // Resolve preferences. Anything not in staff_notification_preferences
    // falls back to notification_types.default_enabled.
    const [{ data: typeRow }, { data: prefs }] = await Promise.all([
      supabase
        .from("notification_types")
        .select("default_enabled")
        .eq("code", typeCode)
        .maybeSingle(),
      supabase
        .from("staff_notification_preferences")
        .select("staff_id, enabled")
        .eq("type_code", typeCode)
        .in("staff_id", targets),
    ]);
    const defaultEnabled = typeRow?.default_enabled ?? true;
    const prefsByStaff = new Map(
      (prefs ?? []).map((p) => [p.staff_id as string, p.enabled as boolean]),
    );

    const filtered = targets.filter((id) => prefsByStaff.get(id) ?? defaultEnabled);
    if (filtered.length === 0) return;

    const rows = filtered.map((staffId) => ({
      staff_id: staffId,
      type_code: typeCode,
      ref_type: refType,
      ref_id: refId,
      title,
      body: body ?? null,
      href: href ?? null,
      metadata: metadata ?? null,
    }));
    await supabase.from("notifications").insert(rows);
  } catch (err) {
    console.error("[notifications] enqueue failed", { typeCode, err });
  }
}
