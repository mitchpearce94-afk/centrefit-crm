"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/ui/toast";

/**
 * Admin-only one-shot: create GoCardless subscriptions for any active plan
 * that has a mandate but no subscription (plans activated before
 * subscriptions existed, so nothing was ever charged). Idempotent and safe to
 * re-run — won't duplicate subscriptions.
 */
export function BackfillSubscriptionsButton() {
  const router = useRouter();
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);

  async function run() {
    setBusy(true);
    try {
      const res = await fetch("/api/admin/recurring/backfill-subscriptions", { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast(data.error ?? "Backfill failed", "error");
      } else if (data.candidates === 0) {
        toast("All active plans already have subscriptions — nothing to backfill.");
      } else {
        toast(`Backfill: ${data.created} subscription(s) created, ${data.failed} failed of ${data.candidates}.`);
        router.refresh();
      }
    } finally {
      setBusy(false);
      setConfirming(false);
    }
  }

  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="rounded-md border border-border px-3 py-2 text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
        title="Create GoCardless subscriptions for active plans that are missing one"
      >
        Backfill GC subscriptions
      </button>
    );
  }

  return (
    <div className="flex items-center gap-1.5">
      <button
        type="button"
        onClick={run}
        disabled={busy}
        className="rounded-md bg-amber-500 px-3 py-2 text-xs font-semibold text-white hover:bg-amber-600 disabled:opacity-50"
      >
        {busy ? "Running…" : "Confirm — charge schedules start"}
      </button>
      <button
        type="button"
        onClick={() => setConfirming(false)}
        disabled={busy}
        className="rounded-md border border-border px-2 py-2 text-xs text-muted-foreground hover:text-foreground"
      >
        Cancel
      </button>
    </div>
  );
}
