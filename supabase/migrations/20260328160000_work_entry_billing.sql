-- Add billing fields to work entries for invoicing
ALTER TABLE public.job_work_entries ADD COLUMN IF NOT EXISTS call_out BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE public.job_work_entries ADD COLUMN IF NOT EXISTS labour_hours NUMERIC(5,2);
-- Materials: JSONB array of {part_id, name, qty, unit_cost}
ALTER TABLE public.job_work_entries ADD COLUMN IF NOT EXISTS materials JSONB DEFAULT '[]';
ALTER TABLE public.job_work_entries ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

CREATE OR REPLACE TRIGGER set_work_entry_updated_at BEFORE UPDATE ON public.job_work_entries
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
