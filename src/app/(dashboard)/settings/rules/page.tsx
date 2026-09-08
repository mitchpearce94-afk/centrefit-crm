import { createClient } from "@/lib/supabase/server";
import { RulesManager } from "./rules-manager";
import { LabourTimingsManager } from "./labour-timings-manager";
import { RulesPageTabs } from "./rules-page-tabs";
import { TemplateDeviceDefaults } from "./template-device-defaults";

export default async function SettingsRulesPage() {
  const supabase = await createClient();
  const [{ data: dbRules }, { data: products }, { data: labourTimings }, { data: templates }, { data: deviceDefaults }] = await Promise.all([
    supabase.from("quote_dependency_rules").select("*").order("template_id, sort_order"),
    supabase.from("quote_products").select("id, name, sku, category, device_type, is_default, discontinued_at, replacement_product_id").eq("is_active", true).order("category, name"),
    supabase.from("labour_timings").select("*").order("sort_order"),
    supabase.from("quote_rule_templates").select("*").order("sort_order"),
    supabase.from("quote_template_device_defaults").select("id, template_id, device_type, product_id"),
  ]);

  return (
    <div>
      <h1 className="text-2xl font-bold tracking-tight">Quoting Rules</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Dependency rules and labour timings for the quote engine.
      </p>
      <div className="mt-5">
        <RulesPageTabs
          dependencyTab={
            <RulesManager
              dbRules={dbRules ?? []}
              products={products ?? []}
              templates={templates ?? []}
            />
          }
          labourTab={<LabourTimingsManager timings={labourTimings ?? []} />}
          deviceDefaultsTab={
            <TemplateDeviceDefaults
              templates={templates ?? []}
              products={(products ?? []) as { id: string; name: string; sku: string | null; device_type: string | null; is_default: boolean | null }[]}
              defaults={deviceDefaults ?? []}
            />
          }
        />
      </div>
    </div>
  );
}
