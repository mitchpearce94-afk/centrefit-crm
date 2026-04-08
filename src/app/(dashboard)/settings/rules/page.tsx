import { createClient } from "@/lib/supabase/server";
import { RulesManager } from "./rules-manager";
import { LabourTimingsManager } from "./labour-timings-manager";
import { RulesPageTabs } from "./rules-page-tabs";

export default async function SettingsRulesPage() {
  const supabase = await createClient();
  const [{ data: dbRules }, { data: products }, { data: labourTimings }] = await Promise.all([
    supabase.from("quote_dependency_rules").select("*").order("preset, sort_order"),
    supabase.from("quote_products").select("id, name, sku, category").eq("is_active", true).order("category, name"),
    supabase.from("labour_timings").select("*").order("sort_order"),
  ]);

  return (
    <div>
      <h1 className="text-2xl font-bold tracking-tight">Quoting Rules</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Dependency rules and labour timings for the quote engine.
      </p>
      <div className="mt-5">
        <RulesPageTabs
          dependencyTab={<RulesManager dbRules={dbRules ?? []} products={products ?? []} />}
          labourTab={<LabourTimingsManager timings={labourTimings ?? []} />}
        />
      </div>
    </div>
  );
}
