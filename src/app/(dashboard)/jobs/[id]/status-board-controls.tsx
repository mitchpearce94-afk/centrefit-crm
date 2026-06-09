"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/ui/toast";

/**
 * Header control for the public status board: flag a job as a "new build"
 * (so it appears on /status-board) and set its rough-in / fit-off dates.
 * Saves inline via the browser client, same pattern as the job create form.
 */
export function StatusBoardControls({
  jobId,
  isNewBuild: initialFlag,
  roughInDate: initialRI,
  fitOffDate: initialFO,
}: {
  jobId: string;
  isNewBuild: boolean;
  roughInDate: string | null;
  fitOffDate: string | null;
}) {
  const supabase = createClient();
  const router = useRouter();
  const { toast } = useToast();
  const [isNewBuild, setIsNewBuild] = useState(initialFlag);
  const [roughIn, setRoughIn] = useState(initialRI ?? "");
  const [fitOff, setFitOff] = useState(initialFO ?? "");
  const [busy, setBusy] = useState(false);

  async function save(updates: Record<string, unknown>): Promise<boolean> {
    setBusy(true);
    const { error } = await supabase.from("jobs").update(updates).eq("id", jobId);
    setBusy(false);
    if (error) {
      toast(error.message, "error");
      return false;
    }
    router.refresh();
    return true;
  }

  async function toggle() {
    const next = !isNewBuild;
    setIsNewBuild(next);
    const ok = await save({ is_new_build: next });
    if (!ok) setIsNewBuild(!next);
    else toast(next ? "Added to status board" : "Removed from status board");
  }

  const dateInput =
    "rounded-md border border-border bg-input px-2 py-1 text-xs text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-50";

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <button
        type="button"
        onClick={toggle}
        disabled={busy}
        title="Show this job on the office status board (/status-board)"
        className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors disabled:opacity-50 ${
          isNewBuild
            ? "border-violet-500/40 bg-violet-500/10 text-violet-300"
            : "border-border text-muted-foreground hover:bg-accent hover:text-foreground"
        }`}
      >
        <span className={`h-1.5 w-1.5 rounded-full ${isNewBuild ? "bg-violet-400" : "bg-muted-foreground"}`} />
        New Build
      </button>

      {isNewBuild && (
        <>
          <label className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
            Rough in
            <input
              type="date"
              value={roughIn}
              disabled={busy}
              onChange={(e) => {
                setRoughIn(e.target.value);
                save({ rough_in_date: e.target.value || null });
              }}
              className={dateInput}
            />
          </label>
          <label className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
            Fit off
            <input
              type="date"
              value={fitOff}
              disabled={busy}
              onChange={(e) => {
                setFitOff(e.target.value);
                save({ fit_off_date: e.target.value || null });
              }}
              className={dateInput}
            />
          </label>
        </>
      )}
    </div>
  );
}
