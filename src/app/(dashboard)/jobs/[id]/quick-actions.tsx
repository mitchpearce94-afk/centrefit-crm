"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import type { Status } from "@/lib/types";

export function QuickActions({
  jobId,
  hasOpenTimer,
  openTimerId,
  allStatuses,
  currentStatusName,
}: {
  jobId: string;
  hasOpenTimer: boolean;
  openTimerId?: string;
  allStatuses: Status[];
  currentStatusName?: string;
}) {
  const router = useRouter();
  const supabase = createClient();
  const [busy, setBusy] = useState<string | null>(null);

  const completeStatus = allStatuses.find((s) => s.name === "Complete");
  const invoiceStatus = allStatuses.find((s) => s.name === "Ready to Invoice");
  const isComplete = currentStatusName === "Complete" || currentStatusName === "Cancelled";

  async function clockIn() {
    setBusy("clock");
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setBusy(null); return; }

    await supabase.from("job_time").insert({
      job_id: jobId,
      staff_id: user.id,
      start_time: new Date().toISOString(),
      billable: true,
    });
    router.refresh();
    setBusy(null);
  }

  async function clockOut() {
    if (!openTimerId) return;
    setBusy("clock");
    await supabase
      .from("job_time")
      .update({ end_time: new Date().toISOString() })
      .eq("id", openTimerId);
    router.refresh();
    setBusy(null);
  }

  async function markComplete() {
    const targetStatus = invoiceStatus ?? completeStatus;
    if (!targetStatus) return;
    setBusy("complete");

    await supabase
      .from("jobs")
      .update({ status_id: targetStatus.id })
      .eq("id", jobId);

    await supabase.from("job_notes").insert({
      job_id: jobId,
      content: `Status changed to "${targetStatus.name}"`,
      type: "system",
    });

    // Clock out if timer is running
    if (openTimerId) {
      await supabase
        .from("job_time")
        .update({ end_time: new Date().toISOString() })
        .eq("id", openTimerId);
    }

    router.refresh();
    setBusy(null);
  }

  return (
    <div className="mt-4 flex flex-wrap gap-2">
      {/* Clock In / Out */}
      {hasOpenTimer ? (
        <button
          onClick={clockOut}
          disabled={busy === "clock"}
          className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-2.5 text-sm font-medium text-destructive transition-colors hover:bg-destructive/20 disabled:opacity-50"
        >
          <span className="h-2 w-2 rounded-full bg-destructive animate-pulse" />
          {busy === "clock" ? "Stopping..." : "Clock Out"}
        </button>
      ) : (
        <button
          onClick={clockIn}
          disabled={busy === "clock" || isComplete}
          className="flex items-center gap-2 rounded-lg border border-success/30 bg-success/10 px-4 py-2.5 text-sm font-medium text-success transition-colors hover:bg-success/20 disabled:opacity-50"
        >
          <ClockIcon className="h-4 w-4" />
          {busy === "clock" ? "Starting..." : "Clock In"}
        </button>
      )}

      {/* Complete Job */}
      {!isComplete && (
        <button
          onClick={markComplete}
          disabled={busy === "complete"}
          className="flex items-center gap-2 rounded-lg border border-success/30 bg-card px-4 py-2.5 text-sm font-medium text-foreground transition-colors hover:bg-success/10 disabled:opacity-50"
        >
          <CheckIcon className="h-4 w-4 text-success" />
          {busy === "complete" ? "Completing..." : "Complete Job"}
        </button>
      )}
    </div>
  );
}

function ClockIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" />
    </svg>
  );
}

function CheckIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}
