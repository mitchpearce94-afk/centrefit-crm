-- =============================================================================
-- job_notes — make notes collaboratively editable (2026-06-18)
-- =============================================================================
-- Staff suggestion (Michael Murphy): when one tech adds a note with photos,
-- another tech should be able to add/edit on that same note rather than having
-- to create a separate notes entry for their own photos.
--
-- Until now UPDATE was restricted to the note's author or an admin, so a second
-- tech editing someone else's note got a silent RLS denial. INSERT and SELECT
-- are already open to all authenticated staff; this brings UPDATE in line so
-- job notes behave as a shared job record.
--
-- DELETE stays author-or-admin (removing someone's note is more destructive and
-- not part of the request).
-- =============================================================================

DROP POLICY IF EXISTS job_notes_update ON public.job_notes;
CREATE POLICY job_notes_update ON public.job_notes
  FOR UPDATE TO authenticated
  USING (true)
  WITH CHECK (true);
