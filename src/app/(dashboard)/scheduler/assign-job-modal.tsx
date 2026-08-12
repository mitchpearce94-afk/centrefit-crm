"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { autoTransitionJobStatus } from "@/lib/job-status-transitions";
import { TimeChooser } from "./time-chooser";

type EntryType = "job" | "event" | "reminder";

interface JobOption {
  id: string;
  number: string;
  reference: string | null;
  customer?: { id: string; name: string };
  site?: { id: string; name: string };
  status?: { id: string; name: string; colour: string };
}

type RecurrencePattern = "weekly" | "fortnightly" | "monthly";
type RecurrenceEnd = "count" | "date" | "ongoing";
const ONGOING_OCCURRENCE_CAP = 26; // ~6 months weekly / ~12 months fortnightly

interface ScheduleEntry {
  id: string;
  job_id: string | null;
  staff_id: string;
  schedule_date: string;
  end_date: string | null;
  start_time: string | null;
  end_time: string | null;
  notes: string | null;
  entry_type: EntryType;
  title: string | null;
  recurrence_group_id?: string | null;
  recurrence_pattern?: RecurrencePattern | null;
  job?: JobOption | null;
}

// Local date string helpers — we only ever deal in en-AU date math, never UTC,
// so a date string stays a date string and never gets pulled into a timezone.
function parseISODate(s: string): Date {
  // Treat YYYY-MM-DD as local midnight to avoid timezone drift on
  // toISOString(). The scheduler is brisbane-local everywhere.
  return new Date(`${s}T00:00:00`);
}
function toISODate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * Generate the list of schedule_date values for a recurring series.
 *
 *   - weekly = +7 days each step
 *   - fortnightly = +14 days each step
 *   - monthly = same day-of-month next month, clamped to last day if
 *     overshooting (e.g. Jan 31 → Feb 28, March 31 → April 30).
 *
 * Ongoing series are capped at ONGOING_OCCURRENCE_CAP so we don't generate
 * thousands of rows. A future cron can extend them lazily — out of scope for
 * v1, Mitchell can manually re-create after ~6 months if needed.
 */
function generateRecurrenceDates(
  startDate: string,
  pattern: RecurrencePattern,
  endType: RecurrenceEnd,
  endDate: string | null,
  occurrenceCount: number | null,
): string[] {
  const dates: string[] = [];
  const start = parseISODate(startDate);
  const max =
    endType === "count"
      ? Math.max(1, Math.min(ONGOING_OCCURRENCE_CAP * 4, occurrenceCount ?? 1))
      : ONGOING_OCCURRENCE_CAP * 4; // outer safety regardless of end type
  const endLimit = endType === "date" && endDate ? parseISODate(endDate) : null;

  for (let i = 0; i < max; i++) {
    let next: Date;
    if (pattern === "weekly") {
      next = new Date(start);
      next.setDate(start.getDate() + i * 7);
    } else if (pattern === "fortnightly") {
      next = new Date(start);
      next.setDate(start.getDate() + i * 14);
    } else {
      // Monthly — add i months, clamp day-of-month to month length.
      const target = new Date(start.getFullYear(), start.getMonth() + i, 1);
      const monthLen = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
      target.setDate(Math.min(start.getDate(), monthLen));
      next = target;
    }
    if (endLimit && next > endLimit) break;
    dates.push(toISODate(next));
    if (endType === "ongoing" && dates.length >= ONGOING_OCCURRENCE_CAP) break;
    if (endType === "count" && dates.length >= (occurrenceCount ?? 1)) break;
  }
  return dates;
}

interface StaffOption {
  id: string;
  display_name: string;
  initials: string;
  colour: string;
}

const QUICK_DURATIONS = [
  { label: "30m", mins: 30 },
  { label: "1h", mins: 60 },
  { label: "2h", mins: 120 },
  { label: "4h", mins: 240 },
];

function timeToMins(t: string | null | undefined): number | null {
  if (!t) return null;
  const [h, m] = t.split(":").map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
  return h * 60 + m;
}

function minsToTime(mins: number): string {
  const m = ((mins % (24 * 60)) + 24 * 60) % (24 * 60);
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

export function AssignJobModal({
  staffId,
  date,
  entry,
  siblings,
  jobs,
  staff,
  defaultStartTime,
  defaultJobId,
  onClose,
  onSaved,
}: {
  staffId: string;
  date: string;
  entry?: ScheduleEntry;
  /** Every entry in the same "tile group" as `entry` — same job (or same
   *  event title/times) on the same date, one row per staff member. The
   *  staff picker edits the whole group: untick = delete that person's row,
   *  tick = insert one. Falls back to [entry] when not provided. */
  siblings?: ScheduleEntry[];
  jobs: JobOption[];
  staff?: StaffOption[];
  /** Legacy — no longer displayed (the group has no "primary" person). */
  staffName?: string;
  defaultStartTime?: string;
  /** Pre-select this job in the picker — used when the user lands on the
   *  scheduler from a "Schedule this job" link inside a job detail page. */
  defaultJobId?: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const supabase = createClient();
  const isEditing = !!entry;

  const [entryType, setEntryType] = useState<EntryType>(entry?.entry_type ?? "job");
  // Multi-select staff — no "primary". On create: fans out one
  // schedule_entry per selected staff (none preselected; whoever's cell was
  // clicked is a hint, not a lock). On edit: preselects EVERYONE in the tile
  // group; save diffs the selection — unticked staff get their row deleted,
  // newly ticked staff get a row inserted. The job card stays the source of
  // truth for the team; the scheduler just mirrors per-day rows.
  const groupEntries = useMemo<ScheduleEntry[]>(
    () => (entry ? (siblings && siblings.length > 0 ? siblings : [entry]) : []),
    [entry, siblings],
  );
  const [selectedStaffIds, setSelectedStaffIds] = useState<string[]>(() => {
    if (entry) return Array.from(new Set(groupEntries.map((s) => s.staff_id)));
    return staffId ? [staffId] : [];
  });
  const [selectedDate, setSelectedDate] = useState(entry?.schedule_date ?? date);
  const [endDate, setEndDate] = useState(entry?.end_date ?? "");
  const [jobId, setJobId] = useState(entry?.job_id ?? defaultJobId ?? "");
  const [title, setTitle] = useState(entry?.title ?? "");
  const [startTime, setStartTime] = useState(entry?.start_time?.slice(0, 5) ?? defaultStartTime ?? "");
  const [endTime, setEndTime] = useState(entry?.end_time?.slice(0, 5) ?? "");
  const [notes, setNotes] = useState(entry?.notes ?? "");
  const [search, setSearch] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Recurrence — create mode only. Generates one row per occurrence on save,
  // tagged with a shared recurrence_group_id so "edit/delete whole series"
  // queries find every sibling later. Edit-mode users go through the
  // editScope picker instead (see below).
  const [recurrencePattern, setRecurrencePattern] = useState<RecurrencePattern | "">("");
  const [recurrenceEnd, setRecurrenceEnd] = useState<RecurrenceEnd>("count");
  const [recurrenceCount, setRecurrenceCount] = useState<number>(12);
  const [recurrenceEndDate, setRecurrenceEndDate] = useState<string>("");

  // Edit scope for an existing recurring entry. Defaults to "occurrence" so
  // a careless save doesn't ripple across the whole series — Mitchell can
  // explicitly opt in to "series" via the toggle.
  const [editScope, setEditScope] = useState<"occurrence" | "series">("occurrence");

  const isPartOfSeries = !!(entry?.recurrence_group_id);

  // Resolve from the picker list, then fall back to the entry's own job data
  // so the "Open Job" link still works for jobs the picker filters out
  // (completion-phase: Ready to Invoice / Complete). Without the fallback the
  // link vanished once a scheduled job was finished. (#10/#11)
  const selectedJob =
    jobs.find((j) => j.id === jobId) ??
    (entry?.job && entry.job.id === jobId ? entry.job : undefined);

  // Lock body scroll while the modal is open — prevents the page behind it
  // from scrolling on mobile and stops the visual "jumping" Mitchell saw
  // when iOS bumped the viewport around with the modal mounted.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  // Drag-to-move (desktop only — bottom-sheet mobile layout stays put).
  // Offset is applied as a translate on top of the existing centred layout
  // so the modal opens centred and can be dragged anywhere from there. Sue
  // wanted this so she can peek at the scheduler grid behind the popup
  // without having to close it.
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });
  const dragStartRef = useRef<{ pointerId: number; startX: number; startY: number; baseX: number; baseY: number } | null>(null);

  function onHeaderPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    // Skip on mobile bottom-sheet (the modal is already full-width pinned
    // to bottom) — only allow drag on lg+ viewports where it floats.
    if (window.innerWidth < 1024) return;
    // Ignore drags that start on the close button itself.
    if ((e.target as HTMLElement).closest("button")) return;
    (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
    dragStartRef.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      baseX: dragOffset.x,
      baseY: dragOffset.y,
    };
  }
  function onHeaderPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    const s = dragStartRef.current;
    if (!s || s.pointerId !== e.pointerId) return;
    setDragOffset({
      x: s.baseX + (e.clientX - s.startX),
      y: s.baseY + (e.clientY - s.startY),
    });
  }
  function onHeaderPointerUp(e: React.PointerEvent<HTMLDivElement>) {
    const s = dragStartRef.current;
    if (s && s.pointerId === e.pointerId) {
      dragStartRef.current = null;
      try {
        (e.currentTarget as HTMLDivElement).releasePointerCapture(e.pointerId);
      } catch {
        // releasePointerCapture throws if already released; non-fatal.
      }
    }
  }

  const filteredJobs = useMemo(() => {
    if (!search || search.length < 2) return [];
    const q = search.toLowerCase();
    return jobs
      .filter(
        (j) =>
          j.number.toLowerCase().includes(q) ||
          (j.customer?.name ?? "").toLowerCase().includes(q) ||
          (j.site?.name ?? "").toLowerCase().includes(q) ||
          (j.reference ?? "").toLowerCase().includes(q),
      )
      .slice(0, 15);
  }, [jobs, search]);

  const isMultiDay = !!endDate && endDate !== selectedDate;

  function applyDuration(mins: number) {
    const startMins = timeToMins(startTime);
    if (startMins == null) {
      // No start yet — set start to 9am if blank, then add duration.
      const baseStart = 9 * 60;
      setStartTime(minsToTime(baseStart));
      setEndTime(minsToTime(baseStart + mins));
    } else {
      setEndTime(minsToTime(startMins + mins));
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    if (entryType === "job" && !jobId) {
      setError("Select a job");
      return;
    }
    if ((entryType === "event" || entryType === "reminder") && !title.trim()) {
      setError("Add a title");
      return;
    }
    if (selectedStaffIds.length === 0) {
      setError(
        isEditing
          ? "Pick at least one staff member — or use Remove to take this off the day entirely."
          : "Pick at least one staff member",
      );
      return;
    }

    if (endDate && endDate < selectedDate) {
      setError("End date can't be before start date");
      return;
    }
    if (
      !isMultiDay &&
      startTime &&
      endTime &&
      timeToMins(endTime)! <= timeToMins(startTime)!
    ) {
      setError("End time must be after start time");
      return;
    }

    setSaving(true);
    setError(null);

    const {
      data: { user },
    } = await supabase.auth.getUser();

    const basePayload = {
      entry_type: entryType,
      job_id: entryType === "job" ? jobId : null,
      title: entryType === "job" ? null : title.trim(),
      schedule_date: selectedDate,
      end_date: endDate && endDate !== selectedDate ? endDate : null,
      start_time: startTime || null,
      end_time: endTime || null,
      notes: notes.trim() || null,
      created_by: user?.id ?? null,
    };

    if (isEditing && entry) {
      // Group edit — the tile group (same job/event, same date, one row per
      // staff) is edited as a unit. Selection diff decides everything:
      //   kept staff   → their rows get the updated fields
      //   unticked     → their rows are DELETED (their tile only)
      //   newly ticked → a fresh row is inserted
      // No "primary" — any person can be removed without nuking the rest.
      //
      // Recurring scope still applies to the shared fields: "series" pushes
      // job/title/times/notes to every occurrence; staff changes are always
      // per-occurrence (this date only) so "Michael is sick Friday" never
      // rewrites the whole series' roster.
      const seriesEditable = {
        entry_type: basePayload.entry_type,
        job_id: basePayload.job_id,
        title: basePayload.title,
        start_time: basePayload.start_time,
        end_time: basePayload.end_time,
        notes: basePayload.notes,
      };

      const byStaff = new Map(groupEntries.map((s) => [s.staff_id, s]));
      const keptIds = groupEntries
        .filter((s) => selectedStaffIds.includes(s.staff_id))
        .map((s) => s.id);
      const removeIds = groupEntries
        .filter((s) => !selectedStaffIds.includes(s.staff_id))
        .map((s) => s.id);
      const addStaffIds = selectedStaffIds.filter((sid) => !byStaff.has(sid));

      if (isPartOfSeries && editScope === "series" && entry.recurrence_group_id) {
        const { error: err } = await supabase
          .from("schedule_entries")
          .update(seriesEditable)
          .eq("recurrence_group_id", entry.recurrence_group_id);
        if (err) { setError(err.message); setSaving(false); return; }
        // Date/end-date changes stay per-occurrence even in series scope.
        if (keptIds.length > 0) {
          const { error: occErr } = await supabase
            .from("schedule_entries")
            .update({ schedule_date: basePayload.schedule_date, end_date: basePayload.end_date })
            .in("id", keptIds);
          if (occErr) { setError(occErr.message); setSaving(false); return; }
        }
      } else if (keptIds.length > 0) {
        // Occurrence scope (default): update every kept row with the full
        // payload — each row keeps its own staff_id.
        const { error: err } = await supabase
          .from("schedule_entries")
          .update(basePayload)
          .in("id", keptIds);
        if (err) { setError(err.message); setSaving(false); return; }
      }

      if (removeIds.length > 0) {
        const { error: delErr } = await supabase
          .from("schedule_entries")
          .delete()
          .in("id", removeIds);
        if (delErr) { setError(`Couldn't remove unticked staff: ${delErr.message}`); setSaving(false); return; }
      }

      if (addStaffIds.length > 0) {
        // New rows are plain per-day entries even on a recurring series —
        // an extra pair of hands for one occurrence shouldn't inherit the
        // whole series.
        const rows = addStaffIds.map((sid) => ({ ...basePayload, staff_id: sid }));
        const { error: insErr, data: insData } = await supabase
          .from("schedule_entries")
          .insert(rows)
          .select("id");
        if (insErr) {
          setError(`Saved but couldn't add ${addStaffIds.length} extra staff: ${insErr.message}`);
          setSaving(false);
          return;
        }
        if (!insData || insData.length !== addStaffIds.length) {
          setError(`Expected ${addStaffIds.length} extra entries, got ${insData?.length ?? 0}. RLS or constraint may be blocking.`);
          setSaving(false);
          return;
        }
      }
    } else if (recurrencePattern) {
      // Create-mode with recurrence: generate every occurrence date, then
      // fan out one row per (occurrence × selected staff). All rows share
      // a single recurrence_group_id so edit-series and delete-series work
      // off it later.
      if (recurrenceEnd === "date" && (!recurrenceEndDate || recurrenceEndDate < selectedDate)) {
        setError("Recurrence end date must be on or after the start date");
        setSaving(false);
        return;
      }
      if (recurrenceEnd === "count" && (recurrenceCount < 1 || recurrenceCount > 104)) {
        setError("Occurrence count must be between 1 and 104");
        setSaving(false);
        return;
      }
      const occurrenceDates = generateRecurrenceDates(
        selectedDate,
        recurrencePattern,
        recurrenceEnd,
        recurrenceEnd === "date" ? recurrenceEndDate : null,
        recurrenceEnd === "count" ? recurrenceCount : null,
      );
      if (occurrenceDates.length === 0) {
        setError("Recurrence produced zero occurrences — check the end condition.");
        setSaving(false);
        return;
      }
      const groupId = crypto.randomUUID();
      const rows: Record<string, unknown>[] = [];
      for (const occDate of occurrenceDates) {
        for (const sid of selectedStaffIds) {
          rows.push({
            ...basePayload,
            schedule_date: occDate,
            // Per-occurrence end_date offset preserves multi-day blocks. If
            // the user picked a span (Mon-Wed), every occurrence is also a
            // Mon-Wed span shifted forward by the cadence.
            end_date:
              basePayload.end_date && basePayload.end_date !== selectedDate
                ? toISODate(
                    new Date(
                      parseISODate(occDate).getTime() +
                        (parseISODate(basePayload.end_date).getTime() -
                          parseISODate(selectedDate).getTime()),
                    ),
                  )
                : null,
            staff_id: sid,
            recurrence_group_id: groupId,
            recurrence_pattern: recurrencePattern,
          });
        }
      }
      const { error: err, data: insData } = await supabase
        .from("schedule_entries")
        .insert(rows)
        .select("id");
      if (err) { setError(err.message); setSaving(false); return; }
      if (!insData || insData.length !== rows.length) {
        setError(`Expected ${rows.length} entries, got ${insData?.length ?? 0}. RLS or constraint may be blocking.`);
        setSaving(false);
        return;
      }
    } else {
      // Create-mode, non-recurring: fan out one row per selected staff.
      const rows = selectedStaffIds.map((sid) => ({ ...basePayload, staff_id: sid }));
      const { error: err, data: insData } = await supabase
        .from("schedule_entries")
        .insert(rows)
        .select("id");
      if (err) {
        setError(err.message);
        setSaving(false);
        return;
      }
      if (!insData || insData.length !== selectedStaffIds.length) {
        setError(`Expected ${selectedStaffIds.length} entries, got ${insData?.length ?? 0}. RLS or constraint may be blocking.`);
        setSaving(false);
        return;
      }
    }

    // Job-only side effect: ensure each scheduled staff is also on the
    // job's assigned team. Without this, the schedule_entry shows up on
    // the scheduler grid but the job never appears under "assigned to
    // <staff>" — the jobs list and Today view both key off job_staff.
    if (entryType === "job" && jobId) {
      const targetStaffIds = selectedStaffIds;
      const { data: existing } = await supabase
        .from("job_staff")
        .select("staff_id")
        .eq("job_id", jobId);
      const have = new Set((existing ?? []).map((r: any) => r.staff_id));
      const missing = targetStaffIds.filter((sid) => !have.has(sid));
      if (missing.length > 0) {
        const { error: jsErr } = await supabase
          .from("job_staff")
          .insert(missing.map((sid) => ({ job_id: jobId, staff_id: sid })));
        if (jsErr) {
          setError(`Schedule saved but couldn't add to job team: ${jsErr.message}`);
          setSaving(false);
          return;
        }
      }
      // Nudge the linked job into "Scheduled" if it's still in a
      // pre-work phase. Events/reminders never touch job status.
      await autoTransitionJobStatus(jobId, "job_scheduled", supabase);

      // Notify the actual assignees they've been scheduled. Fire-and-forget
      // — the modal closes regardless, the bell either shows up or it
      // doesn't, but we don't block the save UX on a notification.
      // Michael flagged 2026-05-27 that he wasn't getting any of these.
      fetch("/api/notifications/job-scheduled", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jobId,
          staffIds: targetStaffIds,
          scheduleDate: basePayload.schedule_date,
          startTime: basePayload.start_time,
          endTime: basePayload.end_time,
        }),
      }).catch(() => {
        // Already saved — a missed notification is recoverable, the
        // schedule entry isn't. Don't fail the modal save on this.
      });
    }

    onSaved();
  }

  async function handleDelete() {
    if (!entry) return;
    const groupIds = groupEntries.map((s) => s.id);
    const staffCount = new Set(groupEntries.map((s) => s.staff_id)).size;

    // Recurring entries get a two-question confirm: delete-one or
    // delete-whole-series. Standalone entries keep the single-question flow.
    // "One" removes this occurrence for EVERYONE on it (the whole tile
    // group that day) — individual staff come off via unticking + Save.
    if (isPartOfSeries && entry.recurrence_group_id) {
      const choice = window.prompt(
        "This entry is part of a recurring series.\n\n" +
          "Type 'one' to delete this occurrence only,\n" +
          "type 'all' to delete the whole series,\n" +
          "or cancel to keep it.",
        "one",
      );
      if (!choice) return;
      const scope = choice.trim().toLowerCase();
      if (scope !== "one" && scope !== "all") {
        setError(`Unknown choice "${choice}" — type "one" or "all".`);
        return;
      }
      setSaving(true);
      const q = supabase.from("schedule_entries").delete();
      const { error: err } = await (scope === "all"
        ? q.eq("recurrence_group_id", entry.recurrence_group_id)
        : q.in("id", groupIds));
      if (err) { setError(err.message); setSaving(false); return; }
      onSaved();
      return;
    }

    const msg =
      staffCount > 1
        ? `Remove this from the day for all ${staffCount} staff? (To take one person off, untick them and Save instead.)`
        : "Remove this schedule entry?";
    if (!confirm(msg)) return;
    setSaving(true);
    const { error: err } = await supabase
      .from("schedule_entries")
      .delete()
      .in("id", groupIds);
    if (err) {
      setError(err.message);
      setSaving(false);
      return;
    }
    onSaved();
  }

  const inputClass =
    "block w-full rounded-md border border-border bg-input px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary";

  const formattedDate = new Date(selectedDate + "T00:00:00").toLocaleDateString(
    "en-AU",
    { weekday: "long", day: "numeric", month: "long", year: "numeric" },
  );

  const headerLabel =
    entryType === "job"
      ? isEditing
        ? "Edit Schedule"
        : "Assign Job"
      : entryType === "event"
        ? isEditing
          ? "Edit Event"
          : "New Event"
        : isEditing
          ? "Edit Reminder"
          : "New Reminder";

  return (
    <div className="fixed inset-0 z-50 flex items-end lg:items-center justify-center">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div
        className="relative w-full max-w-lg rounded-t-2xl lg:rounded-2xl border border-border bg-card shadow-2xl max-h-[90dvh] overflow-y-auto"
        style={{
          transform:
            dragOffset.x || dragOffset.y
              ? `translate(${dragOffset.x}px, ${dragOffset.y}px)`
              : undefined,
        }}
      >
        <div className="p-5">
          <div
            className="flex items-center justify-between mb-4 lg:cursor-move touch-none select-none"
            onPointerDown={onHeaderPointerDown}
            onPointerMove={onHeaderPointerMove}
            onPointerUp={onHeaderPointerUp}
            onPointerCancel={onHeaderPointerUp}
            title="Drag to move (desktop only)"
          >
            <div>
              <h2 className="text-lg font-bold">{headerLabel}</h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                {selectedStaffIds.length > 0
                  ? `${selectedStaffIds.length} staff · ${formattedDate}`
                  : formattedDate}
              </p>
            </div>
            <div className="flex items-center gap-1.5">
              {(dragOffset.x !== 0 || dragOffset.y !== 0) && (
                <button
                  type="button"
                  onClick={() => setDragOffset({ x: 0, y: 0 })}
                  className="hidden lg:inline-block rounded-md border border-border px-2 py-1 text-[10px] font-medium text-muted-foreground hover:text-foreground hover:border-foreground transition-colors"
                  title="Re-centre the modal"
                >
                  Re-centre
                </button>
              )}
              <button
                onClick={onClose}
                className="rounded-md border border-border p-1.5 text-muted-foreground hover:text-foreground hover:border-foreground transition-colors"
              >
                <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M18 6L6 18" /><path d="M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>

          {/* Type toggle */}
          <div className="mb-4 flex rounded-md border border-border p-0.5">
            {(["job", "event", "reminder"] as EntryType[]).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setEntryType(t)}
                disabled={isEditing}
                className={`flex-1 rounded px-3 py-1.5 text-xs font-medium capitalize transition-colors disabled:opacity-60 disabled:cursor-not-allowed ${
                  entryType === t
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {t}
              </button>
            ))}
          </div>
          {isEditing && (
            <p className="-mt-3 mb-4 text-[10px] text-muted-foreground">
              Type can&apos;t change after creation. Delete and recreate if needed.
            </p>
          )}

          {error && (
            <div className="mb-4 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            {staff && staff.length > 0 && (
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1">
                  {isEditing ? "Assigned to" : "Assign to"}
                  <span className="ml-1 text-muted-foreground/70">
                    ({selectedStaffIds.length} selected)
                  </span>
                </label>
                <div className="flex flex-wrap gap-1.5">
                  {staff.map((s) => {
                    const on = selectedStaffIds.includes(s.id);
                    return (
                      <button
                        key={s.id}
                        type="button"
                        onClick={() => {
                          setSelectedStaffIds((prev) =>
                            prev.includes(s.id)
                              ? prev.filter((x) => x !== s.id)
                              : [...prev, s.id]
                          );
                        }}
                        className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors ${
                          on
                            ? "border-transparent text-white"
                            : "border-border bg-card text-muted-foreground hover:text-foreground hover:bg-accent"
                        }`}
                        style={on ? { backgroundColor: s.colour } : undefined}
                      >
                        <span
                          className="flex h-4 w-4 items-center justify-center rounded-full text-[9px] font-semibold text-white"
                          style={{
                            backgroundColor: on ? "rgba(255,255,255,0.25)" : s.colour,
                          }}
                        >
                          {s.initials}
                        </span>
                        {s.display_name}
                      </button>
                    );
                  })}
                </div>
                {!isEditing && selectedStaffIds.length > 1 && (
                  <p className="mt-1 text-[10px] text-muted-foreground">
                    Creates {selectedStaffIds.length} schedule entries, one per
                    selected staff member.
                  </p>
                )}
                {isEditing && (
                  <p className="mt-1 text-[10px] text-muted-foreground">
                    Untick someone to take them off this day only — everyone
                    else&apos;s tiles stay put.
                  </p>
                )}
              </div>
            )}

            {entryType === "job" ? (
              <div>
                <div className="flex items-baseline justify-between mb-1">
                  <label className="block text-xs font-medium text-muted-foreground">
                    Job
                  </label>
                  {isEditing && jobId && selectedJob && (
                    <Link
                      href={`/jobs/${selectedJob.id}`}
                      className="text-xs font-medium text-primary hover:underline"
                    >
                      Open Job →
                    </Link>
                  )}
                </div>
                {jobId && selectedJob ? (
                  <div className="flex items-center justify-between rounded-md border border-border bg-card px-3 py-2">
                    <div>
                      <span className="text-sm font-medium font-mono">
                        {selectedJob.number}
                      </span>
                      <span className="text-sm text-muted-foreground ml-2">
                        {selectedJob.site?.name ?? selectedJob.customer?.name}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setJobId("");
                        setSearch("");
                      }}
                      className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                    >
                      Change
                    </button>
                  </div>
                ) : (
                  <div className="relative">
                    <input
                      type="text"
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      placeholder="Search by job number, customer, or site..."
                      autoFocus={!isEditing}
                      className={inputClass}
                    />
                    {filteredJobs.length > 0 && (
                      <div className="absolute left-0 right-0 top-full z-50 mt-1 max-h-56 overflow-y-auto rounded-lg border border-border bg-card shadow-xl">
                        {filteredJobs.map((job) => (
                          <button
                            key={job.id}
                            type="button"
                            onClick={() => {
                              setJobId(job.id);
                              setSearch("");
                            }}
                            className="flex w-full items-start gap-3 px-3 py-2.5 text-left text-sm hover:bg-accent transition-colors border-b border-border last:border-0"
                          >
                            <div
                              className="mt-1 h-2 w-2 rounded-full shrink-0"
                              style={{
                                backgroundColor: job.status?.colour ?? "#6b7280",
                              }}
                            />
                            <div className="min-w-0">
                              <div className="flex items-center gap-2">
                                <span className="font-medium font-mono">
                                  {job.number}
                                </span>
                                {job.status && (
                                  <span className="text-[10px] text-muted-foreground">
                                    {job.status.name}
                                  </span>
                                )}
                              </div>
                              <p className="text-xs text-muted-foreground truncate">
                                {job.site?.name ?? job.customer?.name}
                              </p>
                            </div>
                          </button>
                        ))}
                      </div>
                    )}
                    {search.length >= 2 && filteredJobs.length === 0 && (
                      <div className="absolute left-0 right-0 top-full z-50 mt-1 rounded-lg border border-border bg-card px-3 py-3 text-sm text-muted-foreground shadow-xl">
                        No jobs found
                      </div>
                    )}
                  </div>
                )}
              </div>
            ) : (
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1">
                  Title
                </label>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder={
                    entryType === "event"
                      ? "e.g. Stock arrival, Site visit"
                      : "e.g. Follow up with Snap Warner"
                  }
                  autoFocus={!isEditing}
                  className={inputClass}
                />
              </div>
            )}

            {/* Start / End date */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1">
                  Start Date
                </label>
                <input
                  type="date"
                  value={selectedDate}
                  onChange={(e) => setSelectedDate(e.target.value)}
                  className={inputClass}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1">
                  End Date <span className="text-muted-foreground/60">(optional)</span>
                </label>
                <input
                  type="date"
                  value={endDate || selectedDate}
                  min={selectedDate}
                  onChange={(e) =>
                    setEndDate(e.target.value === selectedDate ? "" : e.target.value)
                  }
                  className={inputClass}
                />
              </div>
            </div>

            {/* Time window */}
            <div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-muted-foreground mb-1">
                    Start Time
                  </label>
                  <TimeChooser
                    value={startTime}
                    onChange={setStartTime}
                    placeholder="All day"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-muted-foreground mb-1">
                    End Time
                  </label>
                  <TimeChooser
                    value={endTime}
                    onChange={setEndTime}
                    placeholder="All day"
                  />
                </div>
              </div>
              <div className="mt-2 flex items-center gap-1.5 flex-wrap">
                <span className="text-[10px] text-muted-foreground mr-1">Quick:</span>
                {QUICK_DURATIONS.map((d) => (
                  <button
                    key={d.label}
                    type="button"
                    onClick={() => applyDuration(d.mins)}
                    className="rounded-full border border-border px-2.5 py-0.5 text-[10px] font-medium text-muted-foreground hover:text-foreground hover:border-foreground/40 transition-colors"
                  >
                    +{d.label}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => {
                    setStartTime("");
                    setEndTime("");
                  }}
                  className="rounded-full border border-border px-2.5 py-0.5 text-[10px] font-medium text-muted-foreground hover:text-foreground hover:border-foreground/40 transition-colors ml-auto"
                >
                  All-day
                </button>
              </div>
              {isMultiDay && (
                <p className="mt-2 text-[10px] text-muted-foreground">
                  Multi-day entry — these times render on every day of the
                  span. Leave times blank for an all-day multi-day block.
                </p>
              )}
            </div>

            {/* Recurrence — create-mode only. Edit-mode users go through
                the series-edit scope picker below instead. */}
            {!isEditing && (
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1">
                  Repeat
                </label>
                <div className="flex rounded-md border border-border p-0.5">
                  {([
                    { v: "", label: "Off" },
                    { v: "weekly", label: "Weekly" },
                    { v: "fortnightly", label: "Fortnightly" },
                    { v: "monthly", label: "Monthly" },
                  ] as { v: RecurrencePattern | ""; label: string }[]).map((opt) => (
                    <button
                      key={opt.v || "off"}
                      type="button"
                      onClick={() => setRecurrencePattern(opt.v)}
                      className={`flex-1 rounded px-2 py-1.5 text-xs font-medium transition-colors ${
                        recurrencePattern === opt.v
                          ? "bg-primary text-primary-foreground"
                          : "text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>

                {recurrencePattern && (
                  <div className="mt-2 rounded-md border border-border bg-muted/20 p-3 space-y-2">
                    <div className="flex rounded-md border border-border p-0.5 bg-card">
                      {(["count", "date", "ongoing"] as RecurrenceEnd[]).map((opt) => (
                        <button
                          key={opt}
                          type="button"
                          onClick={() => setRecurrenceEnd(opt)}
                          className={`flex-1 rounded px-2 py-1 text-[11px] font-medium capitalize transition-colors ${
                            recurrenceEnd === opt
                              ? "bg-primary/15 text-primary"
                              : "text-muted-foreground hover:text-foreground"
                          }`}
                        >
                          {opt === "count"
                            ? "After N times"
                            : opt === "date"
                              ? "On date"
                              : "Ongoing"}
                        </button>
                      ))}
                    </div>

                    {recurrenceEnd === "count" && (
                      <label className="flex items-center gap-2 text-xs text-muted-foreground">
                        Number of occurrences
                        <input
                          type="number"
                          min={1}
                          max={104}
                          value={recurrenceCount}
                          onChange={(e) =>
                            setRecurrenceCount(Math.max(1, Math.min(104, parseInt(e.target.value || "1", 10))))
                          }
                          className="w-20 rounded-md border border-border bg-input px-2 py-1 text-sm text-foreground"
                        />
                      </label>
                    )}
                    {recurrenceEnd === "date" && (
                      <label className="flex items-center gap-2 text-xs text-muted-foreground">
                        Repeat until
                        <input
                          type="date"
                          value={recurrenceEndDate}
                          min={selectedDate}
                          onChange={(e) => setRecurrenceEndDate(e.target.value)}
                          className="flex-1 rounded-md border border-border bg-input px-2 py-1 text-sm text-foreground"
                        />
                      </label>
                    )}
                    {recurrenceEnd === "ongoing" && (
                      <p className="text-[10px] text-muted-foreground">
                        Schedules {ONGOING_OCCURRENCE_CAP} occurrences upfront ({recurrencePattern === "weekly" ? "~6 months" : recurrencePattern === "fortnightly" ? "~12 months" : "~2 years"}). Re-schedule before they run out.
                      </p>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Edit-mode: series scope toggle for recurring entries. */}
            {isEditing && isPartOfSeries && (
              <div className="rounded-md border border-primary/30 bg-primary/5 p-3 space-y-2">
                <p className="text-xs font-medium text-foreground">
                  Part of a {entry?.recurrence_pattern ?? "recurring"} series.
                </p>
                <div className="flex rounded-md border border-border p-0.5 bg-card">
                  {([
                    { v: "occurrence", label: "Edit this occurrence" },
                    { v: "series", label: "Edit whole series" },
                  ] as { v: "occurrence" | "series"; label: string }[]).map((opt) => (
                    <button
                      key={opt.v}
                      type="button"
                      onClick={() => setEditScope(opt.v)}
                      className={`flex-1 rounded px-2 py-1 text-[11px] font-medium transition-colors ${
                        editScope === opt.v
                          ? "bg-primary/15 text-primary"
                          : "text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
                <p className="text-[10px] text-muted-foreground">
                  {editScope === "series"
                    ? "Job, title, times and notes will apply to every occurrence. Dates and staff changes only apply to this occurrence."
                    : "Changes only affect this single occurrence."}
                </p>
              </div>
            )}

            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">
                Notes
              </label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder={
                  entryType === "job"
                    ? "Optional — travel notes, special instructions..."
                    : "Optional — context, links, follow-up details..."
                }
                rows={2}
                className={`${inputClass} resize-y`}
              />
            </div>

            <div className="flex items-center gap-3 pt-2">
              <button
                type="submit"
                disabled={saving}
                className="rounded-md bg-primary px-5 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
              >
                {saving
                  ? "Saving..."
                  : isEditing
                    ? "Save Changes"
                    : entryType === "job"
                      ? "Assign Job"
                      : "Save"}
              </button>
              <button
                type="button"
                onClick={onClose}
                className="rounded-md border border-border px-4 py-2 text-sm text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
              >
                Cancel
              </button>
              {isEditing && (
                <button
                  type="button"
                  onClick={handleDelete}
                  disabled={saving}
                  className="ml-auto rounded-md border border-border px-4 py-2 text-sm text-destructive hover:bg-destructive/10 hover:border-destructive transition-colors disabled:opacity-50"
                >
                  Remove
                </button>
              )}
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
