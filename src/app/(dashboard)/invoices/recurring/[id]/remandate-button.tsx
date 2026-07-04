"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/ui/toast";

/**
 * Send / re-send the new-owner DD signup for a plan whose site was sold
 * (site-first D4). Route is admin-gated; non-admins get the error toast.
 */
export function RemandateButton({ planId, resend }: { planId: string; resend: boolean }) {
  const router = useRouter();
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);

  async function send() {
    setBusy(true);
    try {
      const res = await fetch(`/api/recurring-plans/${planId}/remandate`, { method: "POST" });
      const json = await res.json();
      if (!res.ok) {
        toast(json.error ?? "Failed to send signup", "error");
        return;
      }
      toast(
        json.emailedTo
          ? `DD signup ${json.resent ? "re-sent" : "sent"} to ${json.emailedTo}`
          : "DD signup link created",
      );
      router.refresh();
    } catch (e) {
      toast(e instanceof Error ? e.message : "Network error", "error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      onClick={send}
      disabled={busy}
      className="rounded-md bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-500 disabled:opacity-50"
    >
      {busy ? "Sending..." : resend ? "Re-send signup" : "Send new-owner DD signup"}
    </button>
  );
}
