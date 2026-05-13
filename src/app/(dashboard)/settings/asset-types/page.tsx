import { createClient } from "@/lib/supabase/server";
import { AssetTypesAdmin } from "./asset-types-admin";

export default async function SettingsAssetTypesPage() {
  const supabase = await createClient();
  const { data: types } = await supabase
    .from("asset_types")
    .select("*")
    .order("sort_order")
    .order("name");

  return (
    <div>
      <h1 className="text-2xl font-bold tracking-tight">Asset Types</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Templates for what can be added to a site&apos;s asset list. Toggle the
        flags to control which fields appear on the asset form for each type.
      </p>
      <div className="mt-5">
        <AssetTypesAdmin types={types ?? []} />
      </div>
    </div>
  );
}
