import { createClient } from "@/lib/supabase/server";
import { QuoteWizard } from "./quote-wizard";

export default async function NewQuotePage() {
  const supabase = await createClient();
  const [customersResult, productsResult, plansResult, billingResult] = await Promise.all([
    supabase.from("customers").select("id, name, customer_sites(id, name, address, suburb, state, postcode), customer_contacts(id, name, phone, mobile, email, is_primary)").eq("is_active", true).order("name"),
    supabase.from("quote_products").select("*").eq("is_active", true).order("category, name"),
    supabase.from("plan_files").select("*").is("quote_id", null).order("created_at", { ascending: false }),
    supabase.from("billing_settings").select("*").single(),
  ]);
  return (
    <div>
      <h1 className="text-2xl font-bold tracking-tight">New Quote</h1>
      <div className="mt-6">
        <QuoteWizard
          customers={customersResult.data ?? []}
          products={productsResult.data ?? []}
          plans={plansResult.data ?? []}
          billingSettings={billingResult.data}
        />
      </div>
    </div>
  );
}
