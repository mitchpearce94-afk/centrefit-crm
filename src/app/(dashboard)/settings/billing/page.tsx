import { createClient } from "@/lib/supabase/server";
import { BillingSettings } from "./billing-settings";

export default async function SettingsBillingPage() {
  const supabase = await createClient();
  const { data: settings } = await supabase
    .from("billing_settings")
    .select("*")
    .single();

  return (
    <div>
      <h1 className="text-2xl font-bold tracking-tight">Billing & Rates</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Configure labour rates, fixed costs, markup, and quote settings.
      </p>
      <div className="mt-5">
        <BillingSettings settings={settings} />
      </div>
    </div>
  );
}
