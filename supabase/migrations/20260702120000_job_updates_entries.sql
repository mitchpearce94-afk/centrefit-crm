-- Job Updates v2: replace the single jobs.updates text box with dated,
-- author-attributed entries (add / edit / archive). Mirrors job_notes.
-- Legacy jobs.updates text is migrated as one unattributed entry per job;
-- the jobs.updates column is kept (read-only legacy) but no longer written.

CREATE TABLE public.job_updates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  staff_id UUID REFERENCES public.staff(id) ON DELETE SET NULL,
  content TEXT NOT NULL,
  edited_at TIMESTAMPTZ,
  archived_at TIMESTAMPTZ,
  archived_by UUID REFERENCES public.staff(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_job_updates_job ON public.job_updates(job_id, created_at DESC);

ALTER TABLE public.job_updates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users can manage job updates"
  ON public.job_updates FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Migrate existing free-text updates: one entry per job, unattributed
-- (renders as "Imported" in the UI).
INSERT INTO public.job_updates (job_id, content)
SELECT id, updates FROM public.jobs
WHERE updates IS NOT NULL AND btrim(updates) <> '';
