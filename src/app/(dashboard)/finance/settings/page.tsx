import { createClient } from "@/lib/supabase/server";
import { loadFinanceViewer } from "@/lib/finance/access";
import { SettingsForm } from "./settings-form";

export const dynamic = "force-dynamic";

export default async function FinanceSettingsPage() {
  const supabase = await createClient();
  const viewer = await loadFinanceViewer(supabase);
  const [{ data: settings }, { data: staff }] = await Promise.all([
    supabase.from("finance_settings").select("*").eq("id", 1).single(),
    supabase.from("staff").select("id, display_name, role, is_active").eq("is_active", true).order("display_name"),
  ]);
  return <SettingsForm settings={settings as never} staff={(staff ?? []) as never} isOwner={!!viewer?.isOwner} />;
}
