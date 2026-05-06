import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service";

/**
 * Clears `must_change_password` on the staff row for the currently
 * authenticated user. Needed because the `staff` table's UPDATE policy is
 * `is_admin()` only — non-admin invitees (e.g. project_managers) cannot
 * clear their own flag from the client SDK, which previously trapped them
 * on the change-password screen forever.
 *
 * Scope is intentionally narrow: this endpoint can ONLY set
 * `must_change_password = false`, ONLY on the caller's own row, and only
 * after Supabase Auth has already confirmed the new password (which the
 * client does via supabase.auth.updateUser before calling this).
 */
export async function POST() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const service = createServiceRoleClient();
  const { error } = await service
    .from("staff")
    .update({ must_change_password: false })
    .eq("id", user.id);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
