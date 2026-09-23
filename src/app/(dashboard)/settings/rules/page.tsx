import { createClient } from "@/lib/supabase/server";
import { RulesManager } from "./rules-manager";
import { LabourTimingsManager } from "./labour-timings-manager";
import { RulesPageTabs } from "./rules-page-tabs";
import { TemplateDeviceDefaults } from "./template-device-defaults";
import { CoverageReport } from "./coverage-report";
import { GapsInbox } from "./gaps-inbox";
import { loadCoverageAndGaps } from "@/lib/quoting/coverage";

export const dynamic = "force-dynamic";

export default async function SettingsRulesPage() {
  const supabase = await createClient();
  const [{ data: dbRules }, { data: products }, { data: labourTimings }, { data: templates }, { data: deviceDefaults }, cov] = await Promise.all([
    supabase.from("quote_dependency_rules").select("*").order("template_id, sort_order"),
    supabase.from("quote_products").select("id, name, sku, category, device_type, is_default, discontinued_at, replacement_product_id").eq("is_active", true).order("category, name"),
    supabase.from("labour_timings").select("*").order("sort_order"),
    supabase.from("quote_rule_templates").select("*").order("sort_order"),
    supabase.from("quote_template_device_defaults").select("id, template_id, device_type, product_id"),
    loadCoverageAndGaps(supabase).catch((e: unknown) => ({ error: e instanceof Error ? e.message : String(e) })),
  ]);
  const coverage = "coverage" in cov ? cov.coverage : null;
  const gaps = "gaps" in cov ? cov.gaps : null;
  const covError = "error" in cov ? cov.error : null;

  return (
    <div>
      <h1 className="text-2xl font-bold tracking-tight">Quoting Rules</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Dependency rules, device defaults, labour timings — and what the engine is missing.
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
          coverageTab={coverage ? <CoverageReport data={coverage} /> : <p className="text-sm text-destructive">Coverage report failed: {covError}</p>}
          gapsTab={gaps ? <GapsInbox data={gaps} /> : <p className="text-sm text-destructive">Gaps inbox failed: {covError}</p>}
        />
      </div>
    </div>
  );
}
