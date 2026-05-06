import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { sendNotificationEmail } from "@/lib/emails/notification-email";

/**
 * Notification fan-out helper. Resolves the audience to staff IDs, checks
 * each staffer's preference (inheriting `notification_types.default_enabled`
 * if no override row exists), inserts notifications rows AND fires emails
 * via Resend when both the type and the staff member's pref opt in.
 *
 * Bell vs email model:
 *   - notification_types.default_enabled  controls bell default
 *   - notification_types.email_enabled    controls email default
 *   - staff_notification_preferences.enabled       overrides bell per-staff
 *   - staff_notification_preferences.email_enabled overrides email per-staff
 *
 * The bell+email default is "high-priority types email by default, low
 * priority bell-only" — see notification_types seed.
 *
 * Usage:
 *   await enqueueNotification({
 *     supabase,
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
  /**
   * Files to attach to the email (e.g. plan PDF on a staff mention for a
   * plan). Bell rows are unaffected — attachments are an email-only
   * concern. Caller is responsible for fetching the bytes.
   */
  attachments?: { filename: string; content: Buffer }[];
}

interface StaffEmailRow {
  id: string;
  email: string | null;
  display_name: string | null;
  is_active: boolean | null;
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
  const { supabase, typeCode, refType, refId, audience, title, body, href, metadata, attachments } = input;
  try {
    const targets = await resolveAudience(supabase, audience);
    if (targets.length === 0) return;

    // Pull type defaults + per-staff overrides + staff email/name in one batch.
    const [{ data: typeRow }, { data: prefs }, { data: staffRows }] = await Promise.all([
      supabase
        .from("notification_types")
        .select("default_enabled, email_enabled")
        .eq("code", typeCode)
        .maybeSingle(),
      supabase
        .from("staff_notification_preferences")
        .select("staff_id, enabled, email_enabled")
        .eq("type_code", typeCode)
        .in("staff_id", targets),
      supabase
        .from("staff")
        .select("id, email, display_name, is_active")
        .in("id", targets),
    ]);

    const defaultBell = typeRow?.default_enabled ?? true;
    const defaultEmail = typeRow?.email_enabled ?? false;
    const prefsByStaff = new Map(
      (prefs ?? []).map((p) => [p.staff_id as string, {
        bell: p.enabled as boolean,
        email: p.email_enabled as boolean | null,
      }]),
    );
    const staffById = new Map(
      ((staffRows ?? []) as StaffEmailRow[]).map((s) => [s.id, s]),
    );

    // Bell first — every recipient who has bell enabled gets a row.
    const bellTargets = targets.filter((id) => prefsByStaff.get(id)?.bell ?? defaultBell);
    if (bellTargets.length > 0) {
      const rows = bellTargets.map((staffId) => ({
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
    }

    // Email — independent of bell. Send only when the type AND the staff
    // pref both opt in. Best-effort; one failure doesn't block the rest.
    const baseUrl =
      process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") ??
      "https://crm.centrefit.com.au";
    const emailTargets = targets.filter((id) => {
      const pref = prefsByStaff.get(id);
      const wantsEmail = pref?.email ?? defaultEmail;
      const wantsBellOrEmail = (pref?.bell ?? defaultBell) || wantsEmail;
      // If a staff has bell off AND email off, they've muted this type.
      return wantsEmail && wantsBellOrEmail;
    });

    if (emailTargets.length > 0) {
      await Promise.all(
        emailTargets.map(async (id) => {
          const staff = staffById.get(id);
          if (!staff?.email || staff.is_active === false) return;
          const greetingName = staff.display_name?.trim().split(/\s+/)[0] ?? null;
          const fullHref = href
            ? (href.startsWith("http") ? href : `${baseUrl}${href.startsWith("/") ? "" : "/"}${href}`)
            : null;
          const result = await sendNotificationEmail({
            to: staff.email,
            greetingName,
            title,
            body: body ?? null,
            href: fullHref,
            typeCode,
            attachments,
          });
          if (!result.ok) {
            console.warn(`[notifications] email send failed`, {
              typeCode,
              staffId: id,
              error: result.error,
            });
          }
        }),
      );
    }
  } catch (err) {
    console.error("[notifications] enqueue failed", { typeCode, err });
  }
}
