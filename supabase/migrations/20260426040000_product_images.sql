-- =============================================================================
-- Product images: image_url column + product-images storage bucket
-- =============================================================================
-- Lets every product carry a small reference image so users can identify
-- products at a glance in the BOM step and the catalog. Bucket is public so
-- thumbnail URLs render without signed-URL handshake on each render.
-- =============================================================================

ALTER TABLE public.quote_products
  ADD COLUMN IF NOT EXISTS image_url TEXT;

INSERT INTO storage.buckets (id, name, public)
VALUES ('product-images', 'product-images', true)
ON CONFLICT (id) DO NOTHING;

-- Authenticated staff can manage product images. Public read mirrors the
-- bucket's public flag so <img src> works without auth.
CREATE POLICY "product_images_auth_upload" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'product-images');

CREATE POLICY "product_images_auth_update" ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'product-images');

CREATE POLICY "product_images_auth_delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'product-images');
