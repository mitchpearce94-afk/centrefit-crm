-- Work entries — the official record of work performed on a job
-- Separate from notes (internal comms) — this is what techs fill out
CREATE TABLE public.job_work_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  staff_id UUID REFERENCES public.staff(id) ON DELETE SET NULL,
  work_date DATE NOT NULL DEFAULT CURRENT_DATE,
  content TEXT NOT NULL,
  image_urls JSONB DEFAULT '[]',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_work_entries_job ON public.job_work_entries(job_id);
CREATE INDEX idx_work_entries_date ON public.job_work_entries(job_id, work_date DESC);

ALTER TABLE public.job_work_entries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "work_entries_select" ON public.job_work_entries
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "work_entries_insert" ON public.job_work_entries
  FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "work_entries_update" ON public.job_work_entries
  FOR UPDATE TO authenticated USING (staff_id = auth.uid() OR public.is_admin());
CREATE POLICY "work_entries_delete" ON public.job_work_entries
  FOR DELETE TO authenticated USING (staff_id = auth.uid() OR public.is_admin());
