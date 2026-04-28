import { createClient } from "@/lib/supabase/server";
import { NewRecurringPlanWizard } from "./wizard";

export default async function NewRecurringPlanPage() {
  const supabase = await createClient();

  const [
    { data: customers },
    { data: services },
  ] = await Promise.all([
    supabase
      .from("customers")
      .select(`
        id, name, is_active,
        customer_contacts(name, email, is_primary),
        customer_sites(id, name, suburb, state)
      `)
      .eq("is_active", true)
      .order("name"),
    supabase
      .from("recurring_services")
      .select("id, code, name, description, price_inc_gst, frequency")
      .eq("active", true)
      .order("sort_order"),
  ]);

  return (
    <NewRecurringPlanWizard
      customers={(customers ?? []) as never}
      services={(services ?? []) as never}
    />
  );
}
