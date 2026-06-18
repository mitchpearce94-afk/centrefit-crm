-- =============================================================================
-- jobs.procurement_not_required — clear labour-only jobs off the board (2026-06-18)
-- =============================================================================
-- Staff suggestion (Lily Duncalfe): a job like "DWP Electrical 640 Boundary
-- Road" has an accepted quote but no orderable parts, so it can't be started
-- ("Generate PO" has nothing to do) and there was no way to mark it done — it
-- sat in "Ready to start" forever.
--
-- This flag lets a job be marked "no procurement needed". The procurement board
-- excludes flagged jobs from "Ready to start" and lists them under a small
-- restorable section, so the board only shows jobs that genuinely need action.
-- =============================================================================

ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS procurement_not_required BOOLEAN NOT NULL DEFAULT false;
