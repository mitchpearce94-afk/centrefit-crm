import { createClient } from "@/lib/supabase/server";
import { notFound } from "next/navigation";
import Link from "next/link";
import { SupplierCatalog } from "./supplier-catalog";

export default async function SupplierCataloguePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const [{ data: supplier }, { data: offers }] = await Promise.all([
    supabase.from("suppliers").select("*").eq("id", id).maybeSingle(),
    supabase
      .from("product_supplier_offers")
      .select(
        "id, product_id, supplier_sku, supplier_item_name, cost_price, cost_updated_at, is_preferred, product:quote_products(id, name, sku, category, image_url, is_active, markup, sell_price)"
      )
      .eq("supplier_id", id),
  ]);

  if (!supplier) notFound();

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link
            href="/suppliers"
            className="text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            ← Suppliers
          </Link>
          <h1 className="mt-1 text-2xl font-bold tracking-tight flex items-center gap-2">
            {supplier.name}
            {!supplier.is_active && (
              <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                Inactive
              </span>
            )}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {[supplier.contact_name, supplier.phone, supplier.email]
              .filter(Boolean)
              .join(" · ") || "No contact details on file"}
            {supplier.account_number ? ` · Acct ${supplier.account_number}` : ""}
          </p>
        </div>
      </div>

      <div className="mt-5">
        <SupplierCatalog
          supplier={{
            id: supplier.id,
            name: supplier.name,
            email: supplier.email,
            is_active: supplier.is_active,
          }}
          offers={(offers ?? []) as never}
        />
      </div>
    </div>
  );
}
