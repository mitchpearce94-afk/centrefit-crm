"use client";

import { useState, useRef, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import type { Status } from "@/lib/types";

const phaseLabels: Record<string, string> = {
  pre_work: "Pre-Work",
  quoting: "Quoting",
  in_progress: "In Progress",
  tracking_hold: "Tracking & Hold",
  completion: "Completion",
};

export function StatusTransition({
  jobId,
  currentStatus,
  allStatuses,
}: {
  jobId: string;
  currentStatus: Status;
  allStatuses: Status[];
}) {
  const [open, setOpen] = useState(false);
  const [updating, setUpdating] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const router = useRouter();
  const supabase = createClient();

  // Close on click outside
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    if (open) document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  async function changeStatus(newStatusId: string) {
    setUpdating(true);
    const { error } = await supabase
      .from("jobs")
      .update({ status_id: newStatusId })
      .eq("id", jobId);

    if (error) {
      alert(`Failed to update status: ${error.message}`);
    } else {
      // Add system note for status change
      const newStatus = allStatuses.find((s) => s.id === newStatusId);
      await supabase.from("job_notes").insert({
        job_id: jobId,
        content: `Status changed from "${currentStatus.name}" to "${newStatus?.name}"`,
        type: "system",
      });
      router.refresh();
    }
    setUpdating(false);
    setOpen(false);
  }

  // Group statuses by phase
  const byPhase: Record<string, Status[]> = {};
  for (const s of allStatuses) {
    if (!byPhase[s.phase]) byPhase[s.phase] = [];
    byPhase[s.phase].push(s);
  }

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(!open)}
        disabled={updating}
        className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-medium transition-colors hover:opacity-80"
        style={{
          backgroundColor: `${currentStatus.colour}20`,
          color: currentStatus.colour,
        }}
      >
        <span
          className="h-2 w-2 rounded-full"
          style={{ backgroundColor: currentStatus.colour }}
        />
        {updating ? "Updating..." : currentStatus.name}
        <svg
          className="h-3 w-3 opacity-60"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {open && (
        <div className="absolute left-0 top-full z-50 mt-1 w-64 rounded-lg border border-border bg-card shadow-xl overflow-hidden">
          <div className="max-h-80 overflow-y-auto">
            {Object.entries(byPhase).map(([phase, statuses]) => (
              <div key={phase}>
                <div className="sticky top-0 bg-muted px-3 py-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                  {phaseLabels[phase] ?? phase}
                </div>
                {statuses.map((s) => (
                  <button
                    key={s.id}
                    onClick={() => changeStatus(s.id)}
                    disabled={s.id === currentStatus.id}
                    className={`flex w-full items-center gap-2 px-3 py-2 text-sm transition-colors ${
                      s.id === currentStatus.id
                        ? "bg-primary/5 text-primary font-medium"
                        : "text-foreground hover:bg-accent"
                    }`}
                  >
                    <span
                      className="h-2 w-2 rounded-full shrink-0"
                      style={{ backgroundColor: s.colour }}
                    />
                    {s.name}
                    {s.id === currentStatus.id && (
                      <span className="ml-auto text-xs text-primary">
                        Current
                      </span>
                    )}
                  </button>
                ))}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
