"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/ui/toast";

interface StaffOption {
  id: string;
  display_name: string;
  initials: string;
  colour: string;
}

interface Props {
  jobId: string;
  allStaff: StaffOption[];
  isNewBuild: boolean;
  roughInDate: string | null;
  roughInEndDate: string | null;
  roughInStaffIds: string[];
  fitOffDate: string | null;
  fitOffEndDate: string | null;
  fitOffStaffIds: string[];
}

/**
 * Job-detail control for the status board / full fit-out flow:
 *  - flag the job as a new build (shows it on /status-board)
 *  - set rough-in & fit-off date RANGES
 *  - assign a crew to each phase, which auto-books them on the scheduler
 * Everything saves through /api/jobs/[id]/board-schedule, which also rebuilds
 * the scheduler entries.
 */
export function StatusBoardControls({
  jobId,
  allStaff,
  isNewBuild: initFlag,
  roughInDate: initRiStart,
  roughInEndDate: initRiEnd,
  roughInStaffIds: initRiStaff,
  fitOffDate: initFoStart,
  fitOffEndDate: initFoEnd,
  fitOffStaffIds: initFoStaff,
}: Props) {
  const router = useRouter();
  const { toast } = useToast();

  const [isNewBuild, setIsNewBuild] = useState(initFlag);
  const [riStart, setRiStart] = useState(initRiStart ?? "");
  const [riEnd, setRiEnd] = useState(initRiEnd ?? "");
  const [riStaff, setRiStaff] = useState<string[]>(initRiStaff ?? []);
  const [foStart, setFoStart] = useState(initFoStart ?? "");
  const [foEnd, setFoEnd] = useState(initFoEnd ?? "");
  const [foStaff, setFoStaff] = useState<string[]>(initFoStaff ?? []);
  const [busy, setBusy] = useState(false);

  // Persist the whole board state in one call. Pass overrides so a setter +
  // sync in the same handler doesn't race React's async state.
  async function sync(over: Partial<{
    isNewBuild: boolean;
    riStart: string; riEnd: string; riStaff: string[];
    foStart: string; foEnd: string; foStaff: string[];
  }> = {}) {
    const payload = {
      isNewBuild: over.isNewBuild ?? isNewBuild,
      roughInDate: (over.riStart ?? riStart) || null,
      roughInEndDate: (over.riEnd ?? riEnd) || null,
      roughInStaffIds: over.riStaff ?? riStaff,
      fitOffDate: (over.foStart ?? foStart) || null,
      fitOffEndDate: (over.foEnd ?? foEnd) || null,
      fitOffStaffIds: over.foStaff ?? foStaff,
    };
    setBusy(true);
    try {
      const res = await fetch(`/api/jobs/${jobId}/board-schedule`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (!res.ok) {
        toast(json.error ?? "Couldn't save", "error");
        return false;
      }
      router.refresh();
      return true;
    } finally {
      setBusy(false);
    }
  }

  async function toggle() {
    const next = !isNewBuild;
    setIsNewBuild(next);
    const ok = await sync({ isNewBuild: next });
    if (!ok) setIsNewBuild(!next);
    else toast(next ? "Added to status board" : "Removed from status board");
  }

  return (
    <div>
      <button
        type="button"
        onClick={toggle}
        disabled={busy}
        title="Mark this job as a full fit-out / new build — shows it on the status board"
        className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors disabled:opacity-50 ${
          isNewBuild
            ? "border-violet-500/40 bg-violet-500/10 text-violet-300"
            : "border-border text-muted-foreground hover:bg-accent hover:text-foreground"
        }`}
      >
        <span className={`h-1.5 w-1.5 rounded-full ${isNewBuild ? "bg-violet-400" : "bg-muted-foreground"}`} />
        New Build / Fit-Out
      </button>

      {isNewBuild && (
        <div className="mt-3 grid gap-3 rounded-lg border border-border bg-card p-4 sm:grid-cols-2 max-w-3xl">
          <PhaseEditor
            label="Rough In"
            accent="#a855f7"
            start={riStart}
            end={riEnd}
            staffIds={riStaff}
            allStaff={allStaff}
            busy={busy}
            onStart={(v) => { setRiStart(v); sync({ riStart: v }); }}
            onEnd={(v) => { setRiEnd(v); sync({ riEnd: v }); }}
            onStaff={(v) => { setRiStaff(v); sync({ riStaff: v }); }}
          />
          <PhaseEditor
            label="Fit Off"
            accent="#8b5cf6"
            start={foStart}
            end={foEnd}
            staffIds={foStaff}
            allStaff={allStaff}
            busy={busy}
            onStart={(v) => { setFoStart(v); sync({ foStart: v }); }}
            onEnd={(v) => { setFoEnd(v); sync({ foEnd: v }); }}
            onStaff={(v) => { setFoStaff(v); sync({ foStaff: v }); }}
          />
          <p className="sm:col-span-2 text-[11px] text-muted-foreground">
            Assigned crew are auto-booked on the scheduler (all-day) across the date range. Changing dates or crew re-syncs the bookings.
          </p>
        </div>
      )}
    </div>
  );
}

const dateInput =
  "rounded-md border border-border bg-input px-2 py-1 text-xs text-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary disabled:opacity-50";

function PhaseEditor({
  label,
  accent,
  start,
  end,
  staffIds,
  allStaff,
  busy,
  onStart,
  onEnd,
  onStaff,
}: {
  label: string;
  accent: string;
  start: string;
  end: string;
  staffIds: string[];
  allStaff: StaffOption[];
  busy: boolean;
  onStart: (v: string) => void;
  onEnd: (v: string) => void;
  onStaff: (v: string[]) => void;
}) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const selected = staffIds
    .map((id) => allStaff.find((s) => s.id === id))
    .filter((s): s is StaffOption => !!s);
  const available = allStaff.filter((s) => !staffIds.includes(s.id));

  return (
    <div className="rounded-md border border-border/60 bg-background/40 p-3">
      <div className="mb-2 flex items-center gap-2">
        <span className="h-2 w-2 rounded-full" style={{ backgroundColor: accent }} />
        <span className="text-xs font-semibold">{label}</span>
      </div>

      <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
        <label className="inline-flex items-center gap-1">
          From
          <input type="date" value={start} disabled={busy} onChange={(e) => onStart(e.target.value)} className={dateInput} />
        </label>
        <label className="inline-flex items-center gap-1">
          To
          <input type="date" value={end} min={start || undefined} disabled={busy} onChange={(e) => onEnd(e.target.value)} className={dateInput} />
        </label>
      </div>

      {/* Crew */}
      <div className="mt-2.5">
        <div className="mb-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Crew</div>
        <div className="flex flex-wrap items-center gap-1.5">
          {selected.map((s) => (
            <span
              key={s.id}
              className="inline-flex items-center gap-1 rounded-full border border-border bg-card px-1.5 py-0.5 text-[11px]"
            >
              <span className="flex h-4 w-4 items-center justify-center rounded-full text-[8px] font-semibold text-white" style={{ backgroundColor: s.colour }}>
                {s.initials}
              </span>
              {s.display_name.split(" ")[0]}
              <button
                type="button"
                disabled={busy}
                onClick={() => onStaff(staffIds.filter((id) => id !== s.id))}
                className="ml-0.5 text-muted-foreground hover:text-destructive disabled:opacity-50"
              >
                ×
              </button>
            </span>
          ))}

          <div className="relative">
            <button
              type="button"
              disabled={busy || available.length === 0}
              onClick={() => setPickerOpen((v) => !v)}
              className="flex h-6 w-6 items-center justify-center rounded-full border border-dashed border-border text-muted-foreground hover:border-primary hover:text-primary disabled:opacity-40"
            >
              +
            </button>
            {pickerOpen && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setPickerOpen(false)} />
                <div className="absolute left-0 top-full z-50 mt-1 max-h-56 w-52 overflow-y-auto rounded-lg border border-border bg-popover shadow-xl">
                  {available.map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => {
                        onStaff([...staffIds, s.id]);
                        setPickerOpen(false);
                      }}
                      className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs hover:bg-accent"
                    >
                      <span className="flex h-5 w-5 items-center justify-center rounded-full text-[9px] font-semibold text-white" style={{ backgroundColor: s.colour }}>
                        {s.initials}
                      </span>
                      {s.display_name}
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
