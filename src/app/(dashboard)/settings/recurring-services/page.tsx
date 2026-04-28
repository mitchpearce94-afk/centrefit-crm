import { createClient } from "@/lib/supabase/server";
import { CatalogueManager } from "./catalogue-manager";

export default async function RecurringServicesSettingsPage() {
  const supabase = await createClient();
  const { data: services } = await supabase
    .from("recurring_services")
    .select("*")
    .order("sort_order");

  return (
    <div className="max-w-4xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Recurring services catalogue</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Services that can be added to recurring direct-debit plans. Prices are GST-inclusive — Xero RepeatingInvoices are created with `lineAmountTypes: Inclusive`.
        </p>
      </div>
      <CatalogueManager initialServices={(services ?? []) as never} />
    </div>
  );
}
