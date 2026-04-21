-- =============================================================================
-- Customers vs Sites split
-- =============================================================================
-- 1. quotes.site_id FK  (quotes currently only link to customer + free-text site)
-- 2. customer_contacts.site_id  (nullable: NULL = customer-level, set = site-level)
-- 3. site_assets stub table  (schema ready; no UI yet — populated later)
-- =============================================================================

-- 1. QUOTES.SITE_ID -----------------------------------------------------------

ALTER TABLE public.quotes
  ADD COLUMN IF NOT EXISTS site_id UUID REFERENCES public.customer_sites(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_quotes_site ON public.quotes(site_id);

-- 2. CUSTOMER_CONTACTS.SITE_ID ------------------------------------------------
-- NULL  = customer-level contact (billing, primary account contact)
-- UUID  = site-specific contact (site manager, key holder, on-site tech)

ALTER TABLE public.customer_contacts
  ADD COLUMN IF NOT EXISTS site_id UUID REFERENCES public.customer_sites(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_contacts_site ON public.customer_contacts(site_id)
  WHERE site_id IS NOT NULL;

-- 3. SITE_ASSETS (stub) -------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.site_assets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id UUID NOT NULL REFERENCES public.customer_sites(id) ON DELETE CASCADE,
  job_id UUID REFERENCES public.jobs(id) ON DELETE SET NULL,
  device_type TEXT,
  device_name TEXT,
  manufacturer TEXT,
  model TEXT,
  serial TEXT,
  mac_address TEXT,
  ip_address TEXT,
  location_note TEXT,
  install_date DATE,
  warranty_expiry DATE,
  notes TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_site_assets_site ON public.site_assets(site_id);
CREATE INDEX IF NOT EXISTS idx_site_assets_job  ON public.site_assets(job_id) WHERE job_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_site_assets_serial ON public.site_assets(serial) WHERE serial IS NOT NULL;

ALTER TABLE public.site_assets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "site_assets_select" ON public.site_assets FOR SELECT TO authenticated USING (true);
CREATE POLICY "site_assets_insert" ON public.site_assets FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "site_assets_update" ON public.site_assets FOR UPDATE TO authenticated USING (true);
CREATE POLICY "site_assets_delete" ON public.site_assets FOR DELETE TO authenticated USING (public.is_admin());
