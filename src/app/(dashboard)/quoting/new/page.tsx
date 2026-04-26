import { createClient } from "@/lib/supabase/server";
import { QuoteWizard } from "./quote-wizard";

export default async function NewQuotePage() {
  const supabase = await createClient();
  const [
    customersResult, productsResult, plansResult, billingResult,
    jobsResult, timingsResult, templatesResult, rulesResult,
  ] = await Promise.all([
    supabase.from("customers").select("id, name, customer_sites(id, name, address, suburb, state, postcode), customer_contacts(id, name, phone, mobile, email, is_primary)").eq("is_active", true).order("name"),
    supabase.from("quote_products").select("*").eq("is_active", true).order("category, name"),
    supabase.from("plan_files").select("*").is("quote_id", null).order("created_at", { ascending: false }),
    supabase.from("billing_settings").select("*").single(),
    supabase.from("jobs").select("id, number, customer:customers(name), site:customer_sites!site_id(name)").order("number", { ascending: false }).limit(200),
    supabase.from("labour_timings").select("code, minutes_per").order("sort_order"),
    supabase.from("quote_rule_templates").select("*").eq("is_active", true).order("sort_order"),
    supabase.from("quote_dependency_rules").select("*").eq("is_active", true).order("sort_order"),
  ]);

  const jobs = (jobsResult.data ?? []).map((j: any) => ({
    id: j.id,
    number: j.number,
    customer_name: Array.isArray(j.customer) ? j.customer[0]?.name : j.customer?.name || null,
    site_name: Array.isArray(j.site) ? j.site[0]?.name : j.site?.name || null,
  }));

  return (
    <div>
      <h1 className="text-2xl font-bold tracking-tight">New Quote</h1>
      <div className="mt-6">
        <QuoteWizard
          customers={customersResult.data ?? []}
          products={productsResult.data ?? []}
          plans={plansResult.data ?? []}
          billingSettings={billingResult.data}
          jobs={jobs}
          labourTimings={Object.fromEntries((timingsResult.data ?? []).map((t: any) => [t.code, t.minutes_per]))}
          templates={templatesResult.data ?? []}
          allRules={rulesResult.data ?? []}
        />
      </div>
    </div>
  );
}
