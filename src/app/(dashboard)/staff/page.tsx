import { createClient } from "@/lib/supabase/server";
import { StaffList } from "./staff-list";

export default async function StaffPage() {
  const supabase = await createClient();

  const [{ data: staff, error }, { data: types }, { data: prefs }] = await Promise.all([
    supabase.from("staff").select("*").order("display_name"),
    supabase
      .from("notification_types")
      .select("code, label, category, description, default_enabled, email_enabled, priority, sort_order")
      .order("sort_order"),
    supabase
      .from("staff_notification_preferences")
      .select("staff_id, type_code, enabled, email_enabled"),
  ]);

  const { data: { user } } = await supabase.auth.getUser();

  // Check if current user is admin
  const currentStaff = staff?.find((s) => s.id === user?.id);
  const isAdmin = currentStaff?.role === "admin";

  if (error) {
    return (
      <div className="text-destructive">
        Error loading staff: {error.message}
      </div>
    );
  }

  // Pre-bucket prefs by staff so the client component doesn't have to filter.
  const prefsByStaff = new Map<string, { type_code: string; enabled: boolean; email_enabled: boolean | null }[]>();
  for (const p of prefs ?? []) {
    const sid = p.staff_id as string;
    if (!prefsByStaff.has(sid)) prefsByStaff.set(sid, []);
    prefsByStaff.get(sid)!.push({
      type_code: p.type_code as string,
      enabled: p.enabled as boolean,
      email_enabled: p.email_enabled as boolean | null,
    });
  }
  const prefsByStaffObj: Record<string, { type_code: string; enabled: boolean; email_enabled: boolean | null }[]> = {};
  for (const [k, v] of prefsByStaff) prefsByStaffObj[k] = v;

  return (
    <div>
      <h1 className="text-2xl font-bold tracking-tight">Staff</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        {staff?.length ?? 0} team members
      </p>
      <div className="mt-6">
        <StaffList
          staff={staff ?? []}
          isAdmin={isAdmin}
          currentUserId={user?.id ?? ""}
          notificationTypes={types ?? []}
          prefsByStaff={prefsByStaffObj}
        />
      </div>
    </div>
  );
}
