import { createClient } from "@/lib/supabase/server";
import { SuppliersList } from "./suppliers-list";

export default async function SuppliersPage() {
  const supabase = await createClient();

  const { data: suppliers } = await supabase
    .from("suppliers")
    .select("*, parts:parts(count)")
    .order("name");

  return (
    <div>
      <h1 className="text-2xl font-bold tracking-tight">
        Suppliers & Parts
      </h1>
      <p className="mt-1 text-sm text-muted-foreground">
        {suppliers?.length ?? 0} suppliers
      </p>

      <div className="mt-5">
        <SuppliersList suppliers={(suppliers ?? []) as any} />
      </div>
    </div>
  );
}
