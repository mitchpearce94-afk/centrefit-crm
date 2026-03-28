-- Create storage bucket for job attachments (photos, receipts, documents)
INSERT INTO storage.buckets (id, name, public)
VALUES ('job-attachments', 'job-attachments', true);

-- Allow authenticated users to upload
CREATE POLICY "auth_upload" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'job-attachments');

-- Allow authenticated users to read
CREATE POLICY "auth_read" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'job-attachments');

-- Allow authenticated users to delete their own uploads
CREATE POLICY "auth_delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'job-attachments');

-- Add image_url column to job_notes for photo attachments
ALTER TABLE public.job_notes ADD COLUMN image_url TEXT;
