"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/ui/toast";

/**
 * Sends the mandate signup email with a FRESH GoCardless link (the old one
 * expires after ~a week). Customer-facing email — confirm before firing.
 * mode="send" is the first send of a DRAFT plan (flips it to pending_mandate
 * server-side); default mode is a resend on an already-emailed plan.
 */
export function ResendSignupButton({ planId, mode = "resend" }: { planId: string; mode?: "resend" | "send" }) {
  const router = useRouter();
  const { toast } = useToast();
  const [sending, setSending] = useState(false);

  const confirmText =
    mode === "send"
      ? "Send the customer their mandate signup email now? This releases the draft."
      : "Email the customer a fresh mandate signup link now?";

  async function handleResend() {
    if (!confirm(confirmText)) return;
    setSending(true);
    try {
      const res = await fetch(`/api/recurring-plans/${planId}/resend-signup`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Send failed");
      toast(
        mode === "send"
          ? `Signup email sent to ${data.to} — plan is now awaiting the mandate.`
          : `Signup email re-sent to ${data.to} with a fresh link.`,
      );
      router.refresh();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Send failed", "error");
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
      {sending ? "Sending…" : mode === "send" ? "Send signup email" : "Resend signup email"}
    </button>
  );
}
