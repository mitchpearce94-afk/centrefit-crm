"use client";

import { useEffect, useMemo, useState } from "react";
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
  job?: JobOption | null;
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
  jobs,
  staff,
  staffName,
  defaultStartTime,
  onClose,
  onSaved,
}: {
  staffId: string;
  date: string;
  entry?: ScheduleEntry;
  jobs: JobOption[];
  staff?: StaffOption[];
  staffName: string;
  defaultStartTime?: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const supabase = createClient();
  const isEditing = !!entry;

  const [entryType, setEntryType] = useState<EntryType>(entry?.entry_type ?? "job");
  const [selectedStaffId, setSelectedStaffId] = useState(entry?.staff_id ?? staffId);
  // Multi-select on create: assigning the same job/event to multiple staff
  // creates N schedule_entries (one per selected staff). On edit we still
  // operate on the single underlying row, so this only matters for new ones.
  const [selectedStaffIds, setSelectedStaffIds] = useState<string[]>(
    entry?.staff_id ? [entry.staff_id] : [staffId],
  );
  const [selectedDate, setSelectedDate] = useState(entry?.schedule_date ?? date);
  const [endDate, setEndDate] = useState(entry?.end_date ?? "");
  const [jobId, setJobId] = useState(entry?.job_id ?? "");
  const [title, setTitle] = useState(entry?.title ?? "");
  const [startTime, setStartTime] = useState(entry?.start_time?.slice(0, 5) ?? defaultStartTime ?? "");
  const [endTime, setEndTime] = useState(entry?.end_time?.slice(0, 5) ?? "");
  const [notes, setNotes] = useState(entry?.notes ?? "");
  const [search, setSearch] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedJob = jobs.find((j) => j.id === jobId);

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
    if (!isEditing && selectedStaffIds.length === 0) {
      setError("Pick at least one staff member");
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
      // Edit-mode operates on the single existing row; staff change is
      // limited to one target (the form swaps to a single select below).
      const { error: err } = await supabase
        .from("schedule_entries")
        .update({ ...basePayload, staff_id: selectedStaffId })
        .eq("id", entry.id);
      if (err) {
        setError(err.message);
        setSaving(false);
        return;
      }
    } else {
      // Create-mode: fan out one row per selected staff member.
      const rows = selectedStaffIds.map((sid) => ({ ...basePayload, staff_id: sid }));
      const { error: err } = await supabase.from("schedule_entries").insert(rows);
      if (err) {
        setError(err.message);
        setSaving(false);
        return;
      }
    }

    // Job-only side effect: nudge the linked job into "Scheduled" if it's
    // still in a pre-work phase. Events/reminders never touch job status.
    if (entryType === "job" && jobId) {
      await autoTransitionJobStatus(jobId, "job_scheduled", supabase);
    }

    onSaved();
  }

  async function handleDelete() {
    if (!entry || !confirm("Remove this schedule entry?")) return;
    setSaving(true);
    const { error: err } = await supabase
      .from("schedule_entries")
      .delete()
      .eq("id", entry.id);
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
      <div className="relative w-full max-w-lg rounded-t-2xl lg:rounded-2xl border border-border bg-card shadow-2xl max-h-[90dvh] overflow-y-auto">
        <div className="p-5">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-lg font-bold">{headerLabel}</h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                {staffName} · {formattedDate}
              </p>
            </div>
            <button
              onClick={onClose}
              className="rounded-md border border-border p-1.5 text-muted-foreground hover:text-foreground hover:border-foreground transition-colors"
            >
              <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M18 6L6 18" /><path d="M6 6l12 12" />
              </svg>
            </button>
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
                  {isEditing ? "Assigned to" : `Assign to (${selectedStaffIds.length} selected)`}
                </label>
                {isEditing ? (
                  <select
                    value={selectedStaffId}
                    onChange={(e) => setSelectedStaffId(e.target.value)}
                    className={inputClass}
                  >
                    {staff.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.display_name}
                      </option>
                    ))}
                  </select>
                ) : (
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
                )}
                {!isEditing && selectedStaffIds.length > 1 && (
                  <p className="mt-1 text-[10px] text-muted-foreground">
                    Creates {selectedStaffIds.length} schedule entries, one per
                    selected staff member.
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
                        {selectedJob.customer?.name}
                        {selectedJob.site ? ` · ${selectedJob.site.name}` : ""}
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
                                {job.customer?.name}
                                {job.site ? ` · ${job.site.name}` : ""}
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
                  Multi-day entry — times apply on the start day. Continues across
                  intermediate days as all-day.
                </p>
              )}
            </div>

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
