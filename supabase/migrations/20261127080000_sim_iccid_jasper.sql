-- SIM cards: link a site asset to its M2M One (Cisco Jasper Control Centre) SIM by ICCID.
-- Jasper is the source of truth for status/plan/usage; the CRM only stores the link.
-- Applied via Supabase MCP 2026-11-27 (db push is blocked for this repo).
ALTER TABLE public.site_assets ADD COLUMN IF NOT EXISTS iccid TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_site_assets_iccid ON public.site_assets(iccid) WHERE iccid IS NOT NULL;
ALTER TABLE public.asset_types ADD COLUMN IF NOT EXISTS has_iccid BOOLEAN NOT NULL DEFAULT false;
UPDATE public.asset_types SET has_iccid = true WHERE slug = 'sim_card';
