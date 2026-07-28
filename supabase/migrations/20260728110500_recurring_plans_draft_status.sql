-- Draft recurring plans: pre-built plan + GC billing request, but the
-- customer signup email is deliberately NOT sent until staff press "Send"
-- (e.g. once the job completes) — Mitchell 2026-07-14 suggestion.
-- Drafts are invisible to the pending-mandate watchdog/retry crons because
-- those filter on status = 'pending_mandate'.
-- Applied to remote 2026-07-28 via MCP; file kept for the record.
ALTER TABLE public.recurring_plans DROP CONSTRAINT IF EXISTS recurring_plans_status_check;
ALTER TABLE public.recurring_plans ADD CONSTRAINT recurring_plans_status_check
  CHECK (status = ANY (ARRAY['draft'::text,'pending_mandate'::text,'active'::text,'paused'::text,'cancelled'::text,'failed'::text]));

-- Staff notes for chasing unsigned mandates. Separate column because the
-- existing `notes` field is a system/error breadcrumb that several routes
-- overwrite with NULL.
ALTER TABLE public.recurring_plans ADD COLUMN IF NOT EXISTS mandate_chase_notes TEXT;
