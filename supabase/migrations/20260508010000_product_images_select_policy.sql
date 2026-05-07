-- The original product-images bucket migration (20260426040000) granted
-- INSERT/UPDATE/DELETE on storage.objects to authenticated but forgot
-- SELECT. supabase-js's upload({ upsert: true }) issues a HEAD/info
-- lookup before deciding INSERT vs UPDATE — without a SELECT policy, RLS
-- silently blocks that lookup, so the storage server can't reconcile the
-- upsert and the request comes back as
-- "new row violates row-level security policy".
--
-- Mirrors the pattern used by job-attachments and plan-files, which both
-- have an SELECT-by-bucket_id policy and upload cleanly.

CREATE POLICY "product_images_auth_read" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'product-images');
