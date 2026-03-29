-- Add state, revision, and file storage columns to plan_files
ALTER TABLE public.plan_files ADD COLUMN IF NOT EXISTS state TEXT DEFAULT 'QLD';
ALTER TABLE public.plan_files ADD COLUMN IF NOT EXISTS revision TEXT DEFAULT 'A';
ALTER TABLE public.plan_files ADD COLUMN IF NOT EXISTS cfp_url TEXT;      -- Supabase Storage URL for .cfp file
ALTER TABLE public.plan_files ADD COLUMN IF NOT EXISTS pdf_url TEXT;      -- Supabase Storage URL for exported PDF
ALTER TABLE public.plan_files ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();

CREATE INDEX IF NOT EXISTS idx_plan_files_state ON public.plan_files(state);

-- Storage bucket for plan files (.cfp and exported PDFs)
INSERT INTO storage.buckets (id, name, public)
VALUES ('plan-files', 'plan-files', true)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "auth_upload_plans" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'plan-files');

CREATE POLICY "auth_read_plans" ON storage.objects
  FOR SELECT USING (bucket_id = 'plan-files');

CREATE POLICY "auth_update_plans" ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'plan-files');

CREATE POLICY "auth_delete_plans" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'plan-files');
