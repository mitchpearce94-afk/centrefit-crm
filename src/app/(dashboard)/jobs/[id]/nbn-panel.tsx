"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/ui/toast";
import type { NbnStepStatus } from "@/lib/types";

const DEFAULT_STEPS = [
  { step_number: 1, name: "NBN Order Placed" },
  { step_number: 2, name: "Appointment Scheduled" },
  { step_number: 3, name: "NTD Installed" },
  { step_number: 4, name: "Lead-in Completed" },
  { step_number: 5, name: "Equipment Configured" },
  { step_number: 6, name: "WAN Connected" },
  { step_number: 7, name: "LAN Configured" },
  { step_number: 8, name: "WiFi Setup" },
  { step_number: 9, name: "Speed Test Passed" },
  { step_number: 10, name: "Customer Sign-off" },
  { step_number: 11, name: "Handover Complete" },
];

const statusColours: Record<NbnStepStatus, { bg: string; text: string; dot: string }> = {
  pending: { bg: "bg-muted/50", text: "text-muted-foreground", dot: "bg-muted-foreground" },
  in_progress: { bg: "bg-primary/10", text: "text-primary", dot: "bg-primary" },
  complete: { bg: "bg-success/10", text: "text-success", dot: "bg-success" },
  skipped: { bg: "bg-muted/30", text: "text-muted-foreground line-through", dot: "bg-muted-foreground" },
};

interface NbnStep {
  id: string;
  job_id: string;
  step_number: number;
  name: string;
  status: NbnStepStatus;
  completed_at: string | null;
  notes: string | null;
}

export function NbnPanel({
  jobId,
  steps,
  isNbnJob,
}: {
  jobId: string;
  steps: NbnStep[];
  isNbnJob: boolean;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const supabase = createClient();
  const [initialising, setInitialising] = useState(false);

  // If not an NBN job and no steps exist, show nothing
  if (!isNbnJob && steps.length === 0) return null;

  async function initSteps() {
    setInitialising(true);
    const { error } = await supabase.from("nbn_steps").insert(
      DEFAULT_STEPS.map((s) => ({
        job_id: jobId,
        step_number: s.step_number,
        name: s.name,
        status: "pending" as const,
      }))
    );
    if (error) {
      toast(error.message, "error");
    } else {
      router.refresh();
    }
    setInitialising(false);
  }

  async function updateStep(stepId: string, status: NbnStepStatus) {
    const update: Record<string, any> = { status };
    if (status === "complete") {
      update.completed_at = new Date().toISOString();
    } else {
      update.completed_at = null;
    }

    const { error } = await supabase
      .from("nbn_steps")
      .update(update)
      .eq("id", stepId);

    if (error) {
      toast(error.message, "error");
    } else {
      router.refresh();
    }
  }

  // No steps yet — offer to initialise
  if (steps.length === 0) {
    return (
      <div className="max-w-lg">
        <p className="text-sm text-muted-foreground mb-3">
          This is an NBN job but no steps have been set up yet.
        </p>
        <button
          onClick={initSteps}
          disabled={initialising}
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
        >
          {initialising ? "Setting up..." : "Initialise NBN Steps"}
        </button>
      </div>
    );
  }

  const completedCount = steps.filter((s) => s.status === "complete").length;
  const progress = Math.round((completedCount / steps.length) * 100);

  return (
    <div className="max-w-lg">
      {/* Progress bar */}
      <div className="mb-5">
        <div className="flex items-center justify-between text-sm mb-1.5">
          <span className="text-muted-foreground">Progress</span>
          <span className="font-medium">
            {completedCount}/{steps.length} steps ({progress}%)
          </span>
        </div>
        <div className="h-2 rounded-full bg-muted overflow-hidden">
          <div
            className="h-full rounded-full bg-success transition-all duration-300"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>

      {/* Steps */}
      <div className="space-y-1.5">
        {steps
          .sort((a, b) => a.step_number - b.step_number)
          .map((step) => {
            const colours = statusColours[step.status];
            return (
              <div
                key={step.id}
                className={`flex items-center justify-between rounded-lg border border-border p-3 ${colours.bg}`}
              >
                <div className="flex items-center gap-3">
                  <span className="flex h-6 w-6 items-center justify-center rounded-full bg-muted text-xs font-medium text-muted-foreground">
                    {step.step_number}
                  </span>
                  <span className={`text-sm font-medium ${colours.text}`}>
                    {step.name}
                  </span>
                </div>
                <select
                  value={step.status}
                  onChange={(e) =>
                    updateStep(step.id, e.target.value as NbnStepStatus)
                  }
                  className="rounded border border-border bg-input px-2 py-1 text-xs focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                >
                  <option value="pending">Pending</option>
                  <option value="in_progress">In Progress</option>
                  <option value="complete">Complete</option>
                  <option value="skipped">Skipped</option>
                </select>
              </div>
            );
          })}
      </div>
    </div>
  );
}
