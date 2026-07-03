import { createClient } from "@/lib/supabase/server";
import { NewRecurringPlanWizard, type SiteOption } from "./wizard";

export default async function NewRecurringPlanPage() {
  const supabase = await createClient();

  const [
    { data: siteRows },
    { data: services },
  ] = await Promise.all([
    supabase
      .from("customer_sites")
      .select(`
        id, name, suburb, state,
        customer:customers(id, name, is_active, customer_contacts(name, email, is_primary))
      `)
      .order("name"),
    supabase
      .from("recurring_services")
      .select("id, code, name, description, price_inc_gst, frequency")
      .eq("active", true)
      .order("sort_order"),
  ]);

  // Site-first (site-first-CONTEXT D5): the wizard picks a site; the backing
  // customer record rides along invisibly. Only sites with an active backing
  // customer are offered.
  const sites: SiteOption[] = (siteRows ?? []).flatMap((row) => {
    const customer = Array.isArray(row.customer) ? row.customer[0] : row.customer;
    if (!customer || !customer.is_active) return [];
    const contacts = (customer.customer_contacts ?? []) as {
      name: string | null; email: string | null; is_primary: boolean;
    }[];
    const primary = contacts.find((c) => c.is_primary) ?? contacts[0];
    return [{
      id: row.id as string,
      name: row.name as string,
      suburb: (row.suburb as string | null) ?? null,
      state: (row.state as string | null) ?? null,
      customer: {
        id: customer.id as string,
        name: customer.name as string,
        contactName: primary?.name ?? null,
        contactEmail: primary?.email ?? null,
      },
    }];
  });

  return (
    <NewRecurringPlanWizard
      sites={sites}
      services={(services ?? []) as never}
    />
  );
}
