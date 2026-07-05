-- Rewrite stored public job-attachment URLs to the authenticated proxy
-- (/api/attachments/<path>), then flip the bucket private. Applied to prod
-- 2026-07-06 AFTER the proxy route deployed (zero-downtime ordering).
-- Rewrote: 31 job_notes.image_url, 53 job_notes.attachments rows,
-- 5 job_work_entries.image_urls, 12 site_key_info_photos.url.
UPDATE job_notes
SET image_url = '/api/attachments/' || split_part(image_url, '/storage/v1/object/public/job-attachments/', 2)
WHERE image_url LIKE '%/storage/v1/object/public/job-attachments/%';

UPDATE job_notes SET attachments = (
  SELECT jsonb_agg(
    CASE WHEN (a->>'url') LIKE '%/storage/v1/object/public/job-attachments/%'
      THEN jsonb_set(a, '{url}', to_jsonb('/api/attachments/' || split_part(a->>'url', '/storage/v1/object/public/job-attachments/', 2)))
      ELSE a END)
  FROM jsonb_array_elements(attachments) a)
WHERE attachments IS NOT NULL AND jsonb_typeof(attachments) = 'array'
  AND attachments::text LIKE '%/storage/v1/object/public/job-attachments/%';

UPDATE job_work_entries SET image_urls = (
  SELECT jsonb_agg(
    CASE WHEN jsonb_typeof(u) = 'string' AND (u #>> '{}') LIKE '%/storage/v1/object/public/job-attachments/%'
      THEN to_jsonb('/api/attachments/' || split_part(u #>> '{}', '/storage/v1/object/public/job-attachments/', 2))
      ELSE u END)
  FROM jsonb_array_elements(image_urls) u)
WHERE image_urls IS NOT NULL AND jsonb_typeof(image_urls) = 'array'
  AND image_urls::text LIKE '%/storage/v1/object/public/job-attachments/%';

UPDATE site_key_info_photos
SET url = '/api/attachments/' || split_part(url, '/storage/v1/object/public/job-attachments/', 2)
WHERE url LIKE '%/storage/v1/object/public/job-attachments/%';

UPDATE storage.buckets SET public = false WHERE id = 'job-attachments';
