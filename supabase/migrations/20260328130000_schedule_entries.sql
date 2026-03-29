-- Schedule entries — dispatch board assignments
-- Links a job to a staff member on a specific date with optional time window

CREATE TABLE public.schedule_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  staff_id UUID NOT NULL REFERENCES public.staff(id) ON DELETE CASCADE,
  schedule_date DATE NOT NULL,
  start_time TIME,
  end_time TIME,
  notes TEXT,
  created_by UUID REFERENCES public.staff(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_schedule_date ON public.schedule_entries(schedule_date);
CREATE INDEX idx_schedule_staff_date ON public.schedule_entries(staff_id, schedule_date);

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.schedule_entries
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

ALTER TABLE public.schedule_entries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "schedule_entries_select" ON public.schedule_entries
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "schedule_entries_insert" ON public.schedule_entries
  FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "schedule_entries_update" ON public.schedule_entries
  FOR UPDATE TO authenticated USING (true);
CREATE POLICY "schedule_entries_delete" ON public.schedule_entries
  FOR DELETE TO authenticated
  USING (created_by = auth.uid() OR public.is_admin());
