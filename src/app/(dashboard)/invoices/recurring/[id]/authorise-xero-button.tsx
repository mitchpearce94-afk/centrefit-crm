"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/ui/toast";

/**
 * Two-step confirm button that flips the plan's Xero RepeatingInvoice
 * template(s) from DRAFT to AUTHORISED. ⚠ Customer-facing — once
 * authorised the next scheduled child will auto-email the customer.
 *
 * Renders inline next to the Xero RI ID(s) on the plan detail page. Hidden
 * automatically when the template is already AUTHORISED (the server-side
 * Xero state check decides whether to show this at all).
 */
export function AuthoriseXeroButton({
  planId,
  customerName,
  templateLabel,
  nextScheduledDate,
}: {
  planId: string;
  customerName: string;
  templateLabel: string;        // e.g. "monthly" / "yearly"
  nextScheduledDate: string | null;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  async function fire() {
    setBusy(true);
    try {
      const res = await fetch(`/api/recurring-plans/${planId}/authorise-xero`, {
        method: "POST",
      });
      const json = await res.json();
      if (!res.ok) {
        toast(json.error ?? "Authorise failed", "error");
        setBusy(false);
        return;
      }
      toast(`${customerName}: Xero template authorised. Next charge fires on schedule + auto-emails the customer.`);
      router.refresh();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Network error", "error");
      setBusy(false);
    }
  }

  if (!confirming) {
    return (
      <button
        onClick={() => setConfirming(true)}
        className="rounded-md border border-primary bg-primary/10 text-primary px-2.5 py-1 text-[11px] font-medium hover:bg-primary/20 transition-colors"
        title="Flip the Xero template from DRAFT to AUTHORISED"
      >
        Authorise in Xero
      </button>
    );
  }

  return (
    <div className="flex flex-col gap-1.5 rounded-md border border-amber-500/40 bg-amber-500/5 p-2 max-w-md">
      <p className="text-[11px] text-amber-300">
        ⚠ Authorising the {templateLabel} template means the next scheduled
        run{nextScheduledDate ? ` (${new Date(nextScheduledDate).toLocaleDateString("en-AU")})` : ""}
        {" "}will auto-generate the invoice AND email it to {customerName}. Confirm?
      </p>
      <div className="flex gap-1.5">
        <button
          onClick={fire}
          disabled={busy}
          className="rounded-md bg-primary px-3 py-1 text-[11px] font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          {busy ? "Authorising..." : "Yes, authorise + auto-email"}
        </button>
        <button
          onClick={() => setConfirming(false)}
          disabled={busy}
          className="rounded-md border border-border px-3 py-1 text-[11px] hover:bg-accent"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
