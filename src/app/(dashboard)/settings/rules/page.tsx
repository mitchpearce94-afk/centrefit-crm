import { createClient } from "@/lib/supabase/server";
import { RulesManager } from "./rules-manager";

export default async function SettingsRulesPage() {
  const supabase = await createClient();
  const [{ data: dbRules }, { data: products }] = await Promise.all([
    supabase.from("quote_dependency_rules").select("*").order("preset, sort_order"),
    supabase.from("quote_products").select("id, name, sku, category").eq("is_active", true).order("category, name"),
  ]);

  return (
    <div>
      <h1 className="text-2xl font-bold tracking-tight">Dependency Rules</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Auto-add rules that populate ancillary products when devices are detected.
      </p>
      <div className="mt-5">
        <RulesManager dbRules={dbRules ?? []} products={products ?? []} />
      </div>
    </div>
  );
}
