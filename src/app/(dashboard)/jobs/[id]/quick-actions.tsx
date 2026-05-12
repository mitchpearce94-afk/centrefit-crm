"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import { autoTransitionJobStatus } from "@/lib/job-status-transitions";
import type { Status } from "@/lib/types";

export function QuickActions({
  jobId,
  hasOpenTimer,
  openTimerId,
  currentStatusName,
  siteAddress,
}: {
  jobId: string;
  hasOpenTimer: boolean;
  openTimerId?: string;
  allStatuses: Status[];
  currentStatusName?: string;
  siteAddress?: string | null;
}) {
  const router = useRouter();
  const supabase = createClient();
  const [busy, setBusy] = useState<string | null>(null);

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
    // Auto-transition to "In Progress" if currently in pre-work/quoting phase
    await autoTransitionJobStatus(jobId, "work_started", supabase);
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
    setBusy("complete");

    // Auto-transition via centralised rules (→ Ready to Invoice)
    await autoTransitionJobStatus(jobId, "job_completed", supabase);

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

  // All three actions live on a single row; each button takes equal width
  // and shrinks (smaller padding / font) on phones so they never wrap.
  const btnBase =
    "flex-1 min-w-0 flex items-center justify-center gap-1.5 rounded-lg border px-2 py-2 text-xs font-medium transition-colors disabled:opacity-50 sm:gap-2 sm:px-4 sm:py-2.5 sm:text-sm";

  return (
    <div className="mt-4 flex flex-nowrap gap-2">
      {/* Clock In / Out */}
      {hasOpenTimer ? (
        <button
          onClick={clockOut}
          disabled={busy === "clock"}
          className={`${btnBase} border-destructive/30 bg-destructive/10 text-destructive hover:bg-destructive/20`}
        >
          <span className="h-2 w-2 rounded-full bg-destructive animate-pulse shrink-0" />
          <span className="truncate">{busy === "clock" ? "Stopping…" : "Clock Out"}</span>
        </button>
      ) : (
        <button
          onClick={clockIn}
          disabled={busy === "clock" || isComplete}
          className={`${btnBase} border-success/30 bg-success/10 text-success hover:bg-success/20`}
        >
          <ClockIcon className="h-4 w-4 shrink-0" />
          <span className="truncate">{busy === "clock" ? "Starting…" : "Clock In"}</span>
        </button>
      )}

      {/* Complete Job */}
      {!isComplete && (
        <button
          onClick={markComplete}
          disabled={busy === "complete"}
          className={`${btnBase} border-success/30 bg-card text-foreground hover:bg-success/10`}
        >
          <CheckIcon className="h-4 w-4 text-success shrink-0" />
          <span className="truncate">{busy === "complete" ? "Completing…" : "Complete"}</span>
        </button>
      )}

      {/* Navigate to Site — native maps per device. */}
      {siteAddress && (
        <button
          type="button"
          onClick={() => {
            const encoded = encodeURIComponent(siteAddress);
            const ua = navigator.userAgent;
            const isIOS =
              /iPad|iPhone|iPod/.test(ua) ||
              (ua.includes("Mac") && typeof document !== "undefined" && "ontouchend" in document);
            const url = isIOS
              ? `https://maps.apple.com/?daddr=${encoded}`
              : `https://www.google.com/maps/dir/?api=1&destination=${encoded}`;
            window.location.href = url;
          }}
          className={`${btnBase} border-primary/30 bg-card text-foreground hover:bg-primary/10`}
        >
          <NavigateIcon className="h-4 w-4 text-primary shrink-0" />
          <span className="truncate">Navigate</span>
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

function NavigateIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="3 11 22 2 13 21 11 13 3 11" />
    </svg>
  );
}
