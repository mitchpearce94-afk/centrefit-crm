import { createClient } from "@/lib/supabase/server";
import { notFound, redirect } from "next/navigation";
import { QuoteWizard } from "../../new/quote-wizard";

export default async function EditQuotePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const [quoteResult, lineItemsResult, extrasResult, customersResult, productsResult, plansResult, linkedPlanResult, jobsResult, billingResult, timingsResult] = await Promise.all([
    supabase.from("quotes").select("*").eq("id", id).single(),
    supabase.from("quote_line_items").select("*").eq("quote_id", id).order("sort_order"),
    supabase.from("quote_extras").select("*").eq("quote_id", id).order("sort_order"),
    supabase.from("customers").select("id, name, customer_sites(id, name, address, suburb, state, postcode), customer_contacts(id, name, phone, mobile, email, is_primary)").order("name"),
    supabase.from("quote_products").select("*").eq("is_active", true).order("category, name"),
    supabase.from("plan_files").select("*").is("quote_id", null).order("created_at", { ascending: false }),
    supabase.from("plan_files").select("*").eq("quote_id", id).maybeSingle(),
    supabase.from("jobs").select("id, number, customer:customers!customer_id(name)").order("number", { ascending: false }).limit(200),
    supabase.from("billing_settings").select("*").single(),
    supabase.from("labour_timings").select("code, minutes_per").order("sort_order"),
  ]);

  if (quoteResult.error || !quoteResult.data) notFound();

  const quote = quoteResult.data as any;

  // Only allow editing drafts
  if (quote.status !== "draft") {
    redirect(`/quoting/${id}`);
  }

  const existingData = {
    quoteId: id,
    ref: quote.ref,
    customerId: quote.customer_id || "",
    siteId: quote.site_id || "",
    jobId: quote.job_id || "",
    planId: linkedPlanResult.data?.id || "",
    clientName: quote.client_name || "",
    siteName: quote.site_name || "",
    siteAddress: quote.site_address || "",
    quoteType: quote.quote_type || "full",
    siteInfo: {
      site_sqm: quote.site_sqm ?? 0,
      door_count: quote.door_count ?? 0,
      external_camera_count: quote.external_camera_count ?? 0,
      concrete_mount_black: quote.concrete_mount_black ?? 0,
      concrete_mount_white: quote.concrete_mount_white ?? 0,
      cardio_count: quote.cardio_count ?? 0,
      tv_count: quote.tv_count ?? 0,
      ceiling_tv_count: quote.ceiling_tv_count ?? 0,
      wall_tv_mount_count: quote.wall_tv_mount_count ?? 0,
      ceiling_tv_mount_count: quote.ceiling_tv_mount_count ?? 0,
      separate_studio_zone: quote.separate_studio_zone ?? false,
    },
    deviceCounts: quote.device_counts || {},
    labourData: quote.labour_data || null,
    discountPercent: quote.discount_percent ?? 0,
    electricianCost: quote.electrician_cost ?? 0,
    elecDoingRoughIn: quote.elec_doing_rough_in ?? false,
    elecDoingFitOff: quote.elec_doing_fit_off ?? false,
    lineItems: lineItemsResult.data ?? [],
    extras: extrasResult.data ?? [],
  };

  // Merge plans: include the one linked to this quote so the dropdown can show it
  const plansList = [...(plansResult.data ?? [])];
  if (linkedPlanResult.data && !plansList.find((p: any) => p.id === linkedPlanResult.data!.id)) {
    plansList.unshift(linkedPlanResult.data);
  }

  const jobsList = (jobsResult.data ?? []).map((j: any) => ({
    id: j.id,
    number: j.number,
    customer_name: Array.isArray(j.customer) ? j.customer[0]?.name ?? null : j.customer?.name ?? null,
  }));

  return (
    <div>
      <h1 className="text-2xl font-bold tracking-tight">Edit Quote — {quote.ref}</h1>
      <p className="mt-1 text-sm text-muted-foreground">Modify the quote details, then save.</p>
      <div className="mt-5">
        <QuoteWizard
          customers={customersResult.data ?? []}
          products={productsResult.data ?? []}
          plans={plansList}
          jobs={jobsList}
          existingQuote={existingData}
          billingSettings={billingResult.data}
          labourTimings={Object.fromEntries((timingsResult.data ?? []).map((t: any) => [t.code, t.minutes_per]))}
        />
      </div>
    </div>
  );
}
