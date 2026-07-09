"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/ui/toast";

/**
 * Re-sends the mandate signup email with a FRESH GoCardless link (the old
 * one expires after ~a week). Customer-facing email — confirm before firing.
 */
export function ResendSignupButton({ planId }: { planId: string }) {
  const router = useRouter();
  const { toast } = useToast();
  const [sending, setSending] = useState(false);

  async function handleResend() {
    if (!confirm("Email the customer a fresh mandate signup link now?")) return;
    setSending(true);
    try {
      const res = await fetch(`/api/recurring-plans/${planId}/resend-signup`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Resend failed");
      toast(`Signup email re-sent to ${data.to} with a fresh link.`);
      router.refresh();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Resend failed", "error");
    } finally {
      setSending(false);
    }
  }

  return (
    <button
      type="button"
      onClick={handleResend}
      disabled={sending}
      className="shrink-0 rounded-md bg-primary px-3 py-1 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
    >
      {sending ? "Sending…" : "Resend signup email"}
    </button>
  );
}
