"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/ui/toast";

/**
 * Cancel button for the recurring plan detail page.
 *
 * Pre-active plans (pending_mandate / failed) hard-delete — no real GC or
 * Xero state to clean up. Active / paused plans cancel the GC mandate +
 * Xero RepeatingInvoice template(s), then soft-cancel the plan (status =
 * 'cancelled', row preserved). Cancelled plans show no button.
 */
export function CancelButton({
  planId,
  status,
  customerName,
  siteLabel,
}: {
  planId: string;
  status: string;
  customerName: string;
  siteLabel: string | null;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [submitting, setSubmitting] = useState(false);

  if (status === "cancelled") return null;

  const isHardDelete = status === "pending_mandate" || status === "failed";
  const buttonLabel = isHardDelete ? "Delete plan" : "Cancel plan";
  const confirmMessage = isHardDelete
    ? `Delete the recurring plan for ${customerName}${siteLabel ? ` — ${siteLabel}` : ""}? The customer hasn't signed yet, so nothing has been set up in GoCardless or Xero — the plan record just gets removed.`
    : `Cancel the active recurring plan for ${customerName}${siteLabel ? ` — ${siteLabel}` : ""}?\n\nThis will:\n• Cancel the GoCardless direct debit mandate (no future debits)\n• Stop the Xero RepeatingInvoice template (no future auto-generated invoices)\n• Mark the plan as cancelled in the CRM\n\nAlready-issued invoices stay in Xero and need separate handling if anything's owed.`;

  async function run() {
    if (!confirm(confirmMessage)) return;
    setSubmitting(true);
    try {
      const res = await fetch(`/api/recurring-plans/${planId}/cancel`, { method: "POST" });
      const json = await res.json();
      if (!res.ok) {
        toast(json.error ?? "Cancel failed", "error");
        setSubmitting(false);
        return;
      }
      if (json.warnings?.length) {
        toast(`Cancelled with warnings: ${json.warnings.join("; ")}`, "error");
      } else {
        toast(isHardDelete ? "Plan deleted" : "Plan cancelled");
      }
      router.push("/invoices/recurring");
      router.refresh();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Network error", "error");
      setSubmitting(false);
    }
  }

  return (
    <button
      onClick={run}
      disabled={submitting}
      className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-1.5 text-xs font-semibold text-destructive hover:bg-destructive/20 disabled:opacity-50 transition-colors"
    >
      {submitting ? "Working..." : buttonLabel}
    </button>
  );
}
