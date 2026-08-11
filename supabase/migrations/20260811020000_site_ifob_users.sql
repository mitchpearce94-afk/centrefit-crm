-- iFob users for the site's security system: [{ name, pin }]. Managed on the
-- Key Information tab next to site notes; printed on the handover pack as the
-- Security System Users box.
ALTER TABLE public.customer_sites
  ADD COLUMN IF NOT EXISTS ifob_users JSONB DEFAULT '[]'::jsonb;
