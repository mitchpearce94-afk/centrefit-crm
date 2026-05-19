-- =============================================================================
-- staff_suggestions — persist in-app suggestion submissions (2026-05-19)
-- =============================================================================
-- Up to now the bulb icon in the top bar emailed Mitchell directly via
-- Resend and dropped the suggestion on the floor afterwards. Adding a
-- table so:
--   1. Mitchell doesn't have to forward suggestions to Claude/anyone else
--      to act on them — a future session can SELECT recent rows.
--   2. We get a history / triage surface (status: new → in_progress → done)
--      if/when staff volume grows.
--
-- UI is unchanged — the bulb modal still fires the same POST. The route
-- writes the row first (cheap), then sends the email (slower, may fail).
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.staff_suggestions (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_id     UUID REFERENCES public.staff(id) ON DELETE SET NULL,
  staff_name   TEXT,                       -- denormalised so suggestion stays readable if staff row is deleted
  staff_email  TEXT,
  category     TEXT NOT NULL CHECK (category IN ('Feature', 'Bug', 'UI/UX', 'Other')),
  body         TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'new'
               CHECK (status IN ('new', 'in_progress', 'done', 'wont_fix')),
  notes        TEXT,                       -- admin triage notes
  email_sent   BOOLEAN NOT NULL DEFAULT false,
  email_error  TEXT,                       -- captured on send failure so we know why
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_staff_suggestions_status_created
  ON public.staff_suggestions(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_staff_suggestions_staff
  ON public.staff_suggestions(staff_id, created_at DESC);

ALTER TABLE public.staff_suggestions ENABLE ROW LEVEL SECURITY;

-- Any authenticated staff can insert (one per submission). staff_id check
-- ensures they can't forge another staffer's submission.
DROP POLICY IF EXISTS staff_suggestions_insert_self ON public.staff_suggestions;
CREATE POLICY staff_suggestions_insert_self ON public.staff_suggestions
  FOR INSERT TO authenticated
  WITH CHECK (staff_id = auth.uid() OR staff_id IS NULL);

-- Only admins read (triage surface). Submitter doesn't need a "my
-- suggestions" view yet — easy to add later by widening the policy.
DROP POLICY IF EXISTS staff_suggestions_admin_read ON public.staff_suggestions;
CREATE POLICY staff_suggestions_admin_read ON public.staff_suggestions
  FOR SELECT TO authenticated
  USING (public.is_admin());

-- Admins update status/notes.
DROP POLICY IF EXISTS staff_suggestions_admin_update ON public.staff_suggestions;
CREATE POLICY staff_suggestions_admin_update ON public.staff_suggestions
  FOR UPDATE TO authenticated
  USING (public.is_admin());

-- updated_at trigger.
CREATE OR REPLACE FUNCTION public._touch_staff_suggestions_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;
DROP TRIGGER IF EXISTS trg_staff_suggestions_updated_at ON public.staff_suggestions;
CREATE TRIGGER trg_staff_suggestions_updated_at
  BEFORE UPDATE ON public.staff_suggestions
  FOR EACH ROW EXECUTE FUNCTION public._touch_staff_suggestions_updated_at();
