"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/ui/toast";

/**
 * Edit the customer-chosen first_invoice_date while a plan is still in
 * pending_mandate state. Once the mandate goes active and the Xero
 * RepeatingInvoice is created, the schedule is locked in Xero and changing
 * it client-side would diverge from reality — this control disables itself
 * upstream by only being rendered for pending plans (see page.tsx).
 */
export function EditStartDateButton({
  planId,
  currentDate,
}: {
  planId: string;
  currentDate: string | null;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState(currentDate ?? "");
  const [submitting, setSubmitting] = useState(false);

  const today = new Date().toISOString().slice(0, 10);

  async function save() {
    setSubmitting(true);
    try {
      const res = await fetch(`/api/recurring-plans/${planId}/start-date`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ firstInvoiceDate: date || null }),
      });
      const json = await res.json();
      if (!res.ok) {
        toast(json.error ?? "Failed to update start date", "error");
        setSubmitting(false);
        return;
      }
      toast(date ? "Start date updated" : "Start date cleared — will bill from mandate verification");
      setOpen(false);
      setSubmitting(false);
      router.refresh();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Network error", "error");
      setSubmitting(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-[11px] text-primary hover:underline"
      >
        Change
      </button>
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-sm rounded-lg border border-border bg-card p-5 shadow-2xl space-y-4">
            <div>
              <h3 className="text-base font-semibold">Change billing start date</h3>
              <p className="text-xs text-muted-foreground mt-1">
                The first auto-generated invoice will fire on this date once the customer&apos;s mandate is verified. Leave blank to bill immediately on verification.
              </p>
            </div>
            <input
              type="date"
              value={date}
              min={today}
              onChange={(e) => setDate(e.target.value)}
              className="w-full rounded-md border border-border bg-input px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
            />
            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={() => setOpen(false)}
                disabled={submitting}
                className="rounded-md border border-border px-3 py-1.5 text-xs hover:bg-accent transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={save}
                disabled={submitting}
                className="rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              >
                {submitting ? "Saving..." : "Save"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
