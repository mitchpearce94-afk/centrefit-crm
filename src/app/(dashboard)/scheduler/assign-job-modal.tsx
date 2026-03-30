"use client";

import { useState, useMemo } from "react";
import { createClient } from "@/lib/supabase/client";
import { autoTransitionJobStatus } from "@/lib/job-status-transitions";

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
  job_id: string;
  staff_id: string;
  schedule_date: string;
  start_time: string | null;
  end_time: string | null;
  notes: string | null;
  job?: JobOption;
}

interface StaffOption {
  id: string;
  display_name: string;
  initials: string;
  colour: string;
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

  const [selectedStaffId, setSelectedStaffId] = useState(entry?.staff_id ?? staffId);
  const [selectedDate, setSelectedDate] = useState(entry?.schedule_date ?? date);
  const [jobId, setJobId] = useState(entry?.job_id ?? "");
  const [startTime, setStartTime] = useState(entry?.start_time?.slice(0, 5) ?? defaultStartTime ?? "");
  const [endTime, setEndTime] = useState(entry?.end_time?.slice(0, 5) ?? "");
  const [notes, setNotes] = useState(entry?.notes ?? "");
  const [search, setSearch] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Selected job display
  const selectedJob = jobs.find((j) => j.id === jobId);

  // Filter jobs by search
  const filteredJobs = useMemo(() => {
    if (!search || search.length < 2) return [];
    const q = search.toLowerCase();
    return jobs
      .filter(
        (j) =>
          j.number.toLowerCase().includes(q) ||
          (j.customer?.name ?? "").toLowerCase().includes(q) ||
          (j.site?.name ?? "").toLowerCase().includes(q) ||
          (j.reference ?? "").toLowerCase().includes(q)
      )
      .slice(0, 15);
  }, [jobs, search]);

  const formattedDate = new Date(selectedDate + "T00:00:00").toLocaleDateString(
    "en-AU",
    { weekday: "long", day: "numeric", month: "long", year: "numeric" }
  );

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!jobId) {
      setError("Select a job");
      return;
    }

    setSaving(true);
    setError(null);

    const {
      data: { user },
    } = await supabase.auth.getUser();

    const payload = {
      job_id: jobId,
      staff_id: selectedStaffId,
      schedule_date: selectedDate,
      start_time: startTime || null,
      end_time: endTime || null,
      notes: notes.trim() || null,
      created_by: user?.id ?? null,
    };

    if (isEditing && entry) {
      const { error: err } = await supabase
        .from("schedule_entries")
        .update(payload)
        .eq("id", entry.id);
      if (err) {
        setError(err.message);
        setSaving(false);
        return;
      }
    } else {
      const { error: err } = await supabase
        .from("schedule_entries")
        .insert(payload);
      if (err) {
        setError(err.message);
        setSaving(false);
        return;
      }
    }

    // Auto-transition job to "Scheduled" if still in pre-work phase
    await autoTransitionJobStatus(jobId, "job_scheduled", supabase);

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

  return (
    <div className="fixed inset-0 z-50 flex items-end lg:items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/60"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="relative w-full max-w-lg rounded-t-2xl lg:rounded-2xl border border-border bg-card shadow-2xl max-h-[90vh] overflow-y-auto">
        <div className="p-5">
          {/* Header */}
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-lg font-bold">
                {isEditing ? "Edit Schedule" : "Assign Job"}
              </h2>
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

          {error && (
            <div className="mb-4 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Staff selection */}
            {staff && staff.length > 0 && (
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1">
                  Staff Member
                </label>
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
              </div>
            )}

            {/* Date */}
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">
                Date
              </label>
              <input
                type="date"
                value={selectedDate}
                onChange={(e) => setSelectedDate(e.target.value)}
                className={inputClass}
              />
            </div>

            {/* Job selection */}
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">
                Job
              </label>

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
                    autoFocus
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
                              backgroundColor:
                                job.status?.colour ?? "#6b7280",
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

            {/* Time window */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1">
                  Start Time
                </label>
                <input
                  type="time"
                  value={startTime}
                  onChange={(e) => setStartTime(e.target.value)}
                  className={inputClass}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-muted-foreground mb-1">
                  End Time
                </label>
                <input
                  type="time"
                  value={endTime}
                  onChange={(e) => setEndTime(e.target.value)}
                  className={inputClass}
                />
              </div>
            </div>
            <p className="text-[10px] text-muted-foreground -mt-2">
              Leave blank for all-day
            </p>

            {/* Notes */}
            <div>
              <label className="block text-xs font-medium text-muted-foreground mb-1">
                Notes
              </label>
              <input
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Optional — travel notes, special instructions..."
                className={inputClass}
              />
            </div>

            {/* Actions */}
            <div className="flex items-center gap-3 pt-2">
              <button
                type="submit"
                disabled={saving || !jobId}
                className="rounded-md bg-primary px-5 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
              >
                {saving
                  ? "Saving..."
                  : isEditing
                  ? "Save Changes"
                  : "Assign Job"}
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
