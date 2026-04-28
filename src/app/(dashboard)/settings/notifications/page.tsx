import { createClient } from "@/lib/supabase/server";
import { NotificationPreferences } from "./prefs";

interface NotificationType {
  code: string;
  label: string;
  category: string;
  description: string | null;
  default_enabled: boolean;
  priority: string;
  sort_order: number;
}

export default async function NotificationSettingsPage() {
  const supabase = await createClient();
  const [{ data: types }, { data: prefs }] = await Promise.all([
    supabase
      .from("notification_types")
      .select("code, label, category, description, default_enabled, priority, sort_order")
      .order("sort_order"),
    supabase
      .from("staff_notification_preferences")
      .select("type_code, enabled"),
  ]);

  const prefsByCode = new Map(
    (prefs ?? []).map((p) => [p.type_code as string, p.enabled as boolean]),
  );

  return (
    <div className="max-w-2xl">
      <h1 className="text-2xl font-semibold tracking-tight">Notifications</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Choose which events ping the bell in the top bar. You can change these any time. Centrefit-wide events stay default-on; chatter you don&apos;t need is default-off.
      </p>

      <NotificationPreferences
        types={(types ?? []) as NotificationType[]}
        initialPrefs={Array.from(prefsByCode.entries())}
      />
    </div>
  );
}
