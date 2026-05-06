-- Allow non-job entries on the scheduler — events (one-off meetings, stock
-- arrivals) and reminders. Jobs continue to behave exactly as before.

ALTER TABLE schedule_entries
  ADD COLUMN IF NOT EXISTS entry_type TEXT NOT NULL DEFAULT 'job'
    CHECK (entry_type IN ('job', 'event', 'reminder')),
  ADD COLUMN IF NOT EXISTS title TEXT,
  ADD COLUMN IF NOT EXISTS end_date DATE;

-- job_id was NOT NULL — relax it so events/reminders can stand alone.
ALTER TABLE schedule_entries
  ALTER COLUMN job_id DROP NOT NULL;

-- Drop and recreate the cross-column rule. Job entries must have a job_id;
-- non-job entries must have a title (events/reminders need something
-- human-readable on the grid).
ALTER TABLE schedule_entries
  DROP CONSTRAINT IF EXISTS schedule_entries_kind_chk;

ALTER TABLE schedule_entries
  ADD CONSTRAINT schedule_entries_kind_chk CHECK (
    (entry_type = 'job' AND job_id IS NOT NULL) OR
    (entry_type IN ('event', 'reminder') AND title IS NOT NULL AND length(trim(title)) > 0)
  );

-- end_date, when set, must be >= schedule_date.
ALTER TABLE schedule_entries
  DROP CONSTRAINT IF EXISTS schedule_entries_end_date_chk;

ALTER TABLE schedule_entries
  ADD CONSTRAINT schedule_entries_end_date_chk CHECK (
    end_date IS NULL OR end_date >= schedule_date
  );
