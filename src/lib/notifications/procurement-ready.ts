import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { enqueueNotification } from "@/lib/notifications/enqueue";

// Mirrors the procurement "Ready to start" gate (see procurement/page.tsx):
// progress jobs only count once PP1 is paid; everything else is ready on accept.
const STRAIGHT_THROUGH_UNDER = 1000;

/**
 * Fire a one-off "ready for procurement — raise the PO" notification when a job
 * first lands in the procurement Ready-to-start list. Safe to call from any of
 * the entry points (quote accepted, PP1 paid) — it re-checks eligibility and
 * dedupes on an existing notification, so multiple calls won't double-notify.
 *
 * Pass a SERVICE-ROLE client (reads across tables + writes notifications).
 */
export async function notifyProcurementReadyIfEligible(
  svc: SupabaseClient,
  jobId: string,
): Promise<void> {
  try {
    if (!jobId) return;

    // Already in procurement? Then it's not sitting in "ready to start".
    const { count: procCount } = await svc
      .from("job_procurement_items")
      .select("id", { count: "exact", head: true })
      .eq("job_id", jobId);
    if ((procCount ?? 0) > 0) return;

    // Needs an accepted quote to be ready.
    const { data: quote } = await svc
      .from("quotes")
      .select("id, ref, quote_type, pricing_snapshot")
      .eq("job_id", jobId)
      .eq("status", "accepted")
      .order("accepted_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!quote) return;

    // Progress jobs over the straight-through threshold wait for PP1 payment.
    const isProgress = quote.quote_type === "progress";
    if (isProgress) {
      const total = Number((quote.pricing_snapshot as { totalExGST?: number } | null)?.totalExGST ?? 0);
      const straightThrough = total > 0 && total < STRAIGHT_THROUGH_UNDER;
      if (!straightThrough) {
        const { data: pp1 } = await svc
          .from("invoices")
          .select("id")
          .eq("quote_id", quote.id)
          .eq("invoice_type", "progress_pp1")
          .eq("status", "paid")
          .limit(1)
          .maybeSingle();
        if (!pp1) return; // PP1 not paid yet — not ready
      }
    }

    // Dedupe — only notify the first time this job becomes ready.
    const { count: already } = await svc
      .from("notifications")
      .select("id", { count: "exact", head: true })
      .eq("ref_type", "job")
      .eq("ref_id", jobId)
      .eq("type_code", "procurement.ready");
    if ((already ?? 0) > 0) return;

    const { data: job } = await svc
      .from("jobs")
      .select("number, customer:customers(name), site:customer_sites(name)")
      .eq("id", jobId)
      .maybeSingle();
    const jobLabel = job?.number ?? "A job";
    const customer = Array.isArray(job?.customer) ? job?.customer[0] : job?.customer;
    const site = Array.isArray(job?.site) ? job?.site[0] : job?.site;
    const quoteTotal = Number((quote.pricing_snapshot as { totalExGST?: number } | null)?.totalExGST ?? 0);

    await enqueueNotification({
      supabase: svc,
      typeCode: "procurement.ready",
      refType: "job",
      refId: jobId,
      audience: { role: "admin" },
      title: `Ready for procurement — ${jobLabel}`,
      body: `${jobLabel} (quote ${quote.ref}) is ready to start — raise the PO.`,
      href: `/procurement/${jobId}`,
      emailDetails: [
        { label: "Job", value: job?.number ?? "" },
        { label: "Customer", value: customer?.name ?? "" },
        { label: "Site", value: site?.name ?? "" },
        { label: "Quote", value: quote.ref ?? "" },
        { label: "Quote total", value: quoteTotal > 0 ? `$${quoteTotal.toFixed(2)} ex GST` : "" },
      ],
      ctaLabel: job?.number ? `Open procurement for ${job.number}` : "Open procurement",
    });
  } catch (err) {
    console.error("[procurement-ready] notify failed", { jobId, err });
  }
}
