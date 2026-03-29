-- Upgrade job_notes for titled entries with multi-file attachments
ALTER TABLE public.job_notes ADD COLUMN IF NOT EXISTS title TEXT;
ALTER TABLE public.job_notes ADD COLUMN IF NOT EXISTS attachments JSONB DEFAULT '[]';

-- Migrate existing image_url data into attachments array
UPDATE public.job_notes
SET attachments = jsonb_build_array(
  jsonb_build_object('url', image_url, 'name', 'Photo', 'type', 'image')
)
WHERE image_url IS NOT NULL AND (attachments IS NULL OR attachments = '[]'::jsonb);
