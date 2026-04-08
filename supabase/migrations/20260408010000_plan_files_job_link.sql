-- Add direct job_id to plan_files so plans survive quote deletion
ALTER TABLE public.plan_files ADD COLUMN IF NOT EXISTS job_id UUID REFERENCES public.jobs(id);
CREATE INDEX IF NOT EXISTS idx_plan_files_job_id ON public.plan_files(job_id);
