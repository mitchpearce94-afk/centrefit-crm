import { createClient } from "@/lib/supabase/server";
import { SuppliersList } from "./suppliers-list";

export default async function SuppliersPage() {
  const supabase = await createClient();

  // The old `parts` table was dropped in the 2026-09-08 products cleanup
  // (inventory-CONTEXT D1: one catalogue). Embedding it here made PostgREST
  // reject the whole query, which this page swallowed as "0 suppliers".
  const { data: suppliers, error } = await supabase
    .from("suppliers")
    .select("*, offers:product_supplier_offers(count)")
    .order("name");

  return (
    <div>
      <h1 className="text-2xl font-bold tracking-tight">
        Suppliers
      </h1>
      <p className="mt-1 text-sm text-muted-foreground">
        {error ? "Couldn't load suppliers" : `${suppliers?.length ?? 0} suppliers`}
      </p>
      {error && (
        <p className="mt-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          {error.message}
        </p>
      )}

      <div className="mt-5">
        <SuppliersList suppliers={(suppliers ?? []) as any} />
      </div>
    </div>
  );
}
