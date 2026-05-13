import { createClient } from "@/lib/supabase/server";
import { notFound } from "next/navigation";
import Link from "next/link";
import { StatusTransition } from "./status-transition";
import { JobTabs } from "./job-tabs";

export default async function JobDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const [jobResult, statusesResult, staffResult, workResult, notesResult, timeResult, nbnResult, checklistResult, templatesResult, scheduleResult, invoicesResult, linkedQuotesResult, billingResult, procurementResult, suppliersResult] =
    await Promise.all([
      supabase
        .from("jobs")
        .select(
          "*, customer:customers(id, name), site:customer_sites(id, name, address, suburb, state, postcode), status:statuses(*), category_1:categories!category_1_id(id, name), category_2:categories!category_2_id(id, name), job_staff(id, role, staff:staff(id, display_name, initials, colour, email, phone))"
        )
        .eq("id", id)
        .single(),
      supabase.from("statuses").select("*").order("sort_order"),
      supabase
        .from("staff")
        .select("id, display_name, initials, colour")
        .eq("is_active", true),
      // Oldest-first so the on-screen list mirrors the invoice narrative
      // (which is already sorted oldest → newest in buildNarrative).
      supabase
        .from("job_work_entries")
        .select("*, staff:staff(display_name, initials, colour)")
        .eq("job_id", id)
        .order("work_date", { ascending: true })
        .order("created_at", { ascending: true }),
      supabase
        .from("job_notes")
        .select("*, staff:staff(display_name, initials, colour)")
        .eq("job_id", id)
        .order("created_at", { ascending: false }),
      supabase
        .from("job_time")
        .select("*, staff:staff(display_name, initials, colour)")
        .eq("job_id", id)
        .order("start_time", { ascending: false }),
      supabase
        .from("nbn_steps")
        .select("*")
        .eq("job_id", id)
        .order("step_number"),
      supabase
        .from("job_checklist_items")
        .select("*")
        .eq("job_id", id)
        .order("sort_order"),
      supabase
        .from("checklist_templates")
        .select("*")
        .eq("is_active", true)
        .order("name"),
      supabase
        .from("schedule_entries")
        .select("id, schedule_date, start_time, end_time, notes, staff_id, staff:staff!schedule_entries_staff_id_fkey(display_name, initials, colour)")
        .eq("job_id", id)
        .order("schedule_date", { ascending: false })
        .limit(10),
      supabase
        .from("invoices")
        .select("*")
        .eq("job_id", id)
        .order("created_at", { ascending: true }),
      supabase
        .from("quotes")
        .select("id, ref, status, quote_type, pricing_snapshot")
        .eq("job_id", id),
      supabase
        .from("billing_settings")
        .select("labour_sell_rate, callout_fee_sell")
        .limit(1)
        .maybeSingle(),
      supabase
        .from("job_procurement_items")
        .select("*, received_by_staff:staff!job_procurement_items_received_by_fkey(display_name)")
        .eq("job_id", id)
        .order("created_at", { ascending: true })
        .order("id", { ascending: true }),
      supabase
        .from("suppliers")
        .select("id, name")
        .eq("is_active", true)
        .order("name"),
    ]);

  if (jobResult.error || !jobResult.data) {
    notFound();
  }

  const job = jobResult.data;
  const isNbnJob = job.category_1?.name?.includes("NBN") ?? false;
  const hasOpenTimer = (timeResult.data ?? []).some((t: any) => !t.end_time);

  // Resolve current viewer's role so admin-only actions (e.g. raising a
  // variance invoice on top of an already-quoted job) can be gated on the
  // server before the UI renders. Non-admins still see the tab content.
  const { data: { user } } = await supabase.auth.getUser();
  let isAdmin = false;
  if (user) {
    const { data: viewerStaff } = await supabase
      .from("staff")
      .select("role")
      .eq("id", user.id)
      .maybeSingle();
    isAdmin = viewerStaff?.role === "admin";
  }

  // Look up sell_price for every product referenced in the work-log materials
  // so the invoice modal can auto-populate priced line items at the quoted rate.
  const productIds = new Set<string>();
  for (const w of (workResult.data ?? []) as any[]) {
    for (const m of (w.materials ?? []) as any[]) {
      if (m?.product_id) productIds.add(m.product_id);
    }
  }
  let productPrices: Record<string, { sell_price: number; cost_price: number }> = {};
  if (productIds.size > 0) {
    const { data: products } = await supabase
      .from("quote_products")
      .select("id, sell_price, cost_price")
      .in("id", Array.from(productIds));
    for (const p of (products ?? []) as any[]) {
      productPrices[p.id] = {
        sell_price: Number(p.sell_price) || 0,
        cost_price: Number(p.cost_price) || 0,
      };
    }
  }

  const billingSettings = {
    labour_sell_rate: Number(billingResult.data?.labour_sell_rate ?? 150),
    callout_fee_sell: Number(billingResult.data?.callout_fee_sell ?? 80),
  };

  return (
    <div>
      {/* ── Compact header ── */}
      <div className="flex items-center gap-2 text-sm">
        <Link
          href="/jobs"
          className="text-muted-foreground hover:text-foreground transition-colors"
        >
          Jobs
        </Link>
        <span className="text-muted-foreground">/</span>
      </div>

      <div className="mt-1 flex items-center gap-3 flex-wrap">
        <h1 className="text-2xl font-bold tracking-tight font-mono">
          {job.number}
        </h1>
        <StatusTransition
          jobId={id}
          currentStatus={job.status as any}
          allStatuses={statusesResult.data ?? []}
        />
      </div>

      {/* ── Full tab interface ── */}
      <div className="mt-4">
        <JobTabs
          jobId={id}
          job={job}
          allStatuses={statusesResult.data ?? []}
          allStaff={staffResult.data ?? []}
          notes={notesResult.data ?? []}
          timeEntries={timeResult.data ?? []}
          nbnSteps={nbnResult.data ?? []}
          workEntries={workResult.data ?? []}
          checklistItems={(checklistResult.data ?? []) as any}
          templates={(templatesResult.data ?? []) as any}
          isNbnJob={isNbnJob}
          hasOpenTimer={hasOpenTimer}
          openTimerId={(timeResult.data ?? []).find((t: any) => !t.end_time)?.id}
          scheduleEntries={scheduleResult.data ?? []}
          invoices={(invoicesResult.data ?? []) as any[]}
          linkedQuotes={(linkedQuotesResult.data ?? []) as any[]}
          procurementItems={(procurementResult.data ?? []) as any[]}
          suppliers={(suppliersResult.data ?? []) as any[]}
          productPrices={productPrices}
          billingSettings={billingSettings}
          isAdmin={isAdmin}
        />
      </div>
    </div>
  );
}
