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

    const { data: job } = await svc.from("jobs").select("number").eq("id", jobId).maybeSingle();
    const jobLabel = job?.number ?? "A job";

    await enqueueNotification({
      supabase: svc,
      typeCode: "procurement.ready",
      refType: "job",
      refId: jobId,
      audience: { role: "admin" },
      title: `Ready for procurement — ${jobLabel}`,
      body: `${jobLabel} (quote ${quote.ref}) is ready to start — raise the PO.`,
      href: `/procurement/${jobId}`,
    });
  } catch (err) {
    console.error("[procurement-ready] notify failed", { jobId, err });
  }
}
