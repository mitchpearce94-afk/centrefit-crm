"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/ui/toast";

export function RetryActivationButton({ planId }: { planId: string }) {
  const router = useRouter();
  const { toast } = useToast();
  const [retrying, setRetrying] = useState(false);

  async function handleRetry() {
    setRetrying(true);
    try {
      const res = await fetch("/api/admin/recurring/retry", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ planId }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error ?? "Retry failed");
      }
      const r = data.result;
      if (r?.ok) {
        if (r.skipped === "already_active") {
          toast("Plan was already active — refreshed.");
        } else {
          toast("Activation succeeded — Xero RepeatingInvoice created.");
        }
      } else {
        // activatePlan returned ok:false — the failure has been recorded
        // and the notification fired; show the reason inline so Mitchell
        // doesn't have to chase the bell.
        toast(`Still failing: ${r?.reason ?? "unknown"}`, "error");
      }
      router.refresh();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Retry failed", "error");
    } finally {
      setRetrying(false);
    }
  }

  return (
    <button
      type="button"
      onClick={handleRetry}
      disabled={retrying}
      className="shrink-0 rounded-md bg-destructive px-3 py-1.5 text-xs font-medium text-white hover:bg-destructive/90 disabled:opacity-50 transition-colors"
    >
      {retrying ? "Retrying…" : "Retry activation now"}
    </button>
  );
}
