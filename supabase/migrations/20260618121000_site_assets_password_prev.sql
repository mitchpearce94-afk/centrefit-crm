-- =============================================================================
-- site_assets — keep the previous password (2026-06-18)
-- =============================================================================
-- Staff suggestion (Michael Murphy): a button to reveal the LAST previous
-- password on an asset. When a password is regenerated/changed it's easy to
-- lose the value that was there before; these columns hold the immediately
-- prior admin/staff password so the edit form can surface it behind a reveal.
--
-- Written explicitly by the asset edit form on the deliberate change events
-- (generate / field blur), so they always hold a complete previous value — not
-- a half-typed one. No trigger needed.
-- =============================================================================

ALTER TABLE public.site_assets
  ADD COLUMN IF NOT EXISTS admin_password_prev TEXT,
  ADD COLUMN IF NOT EXISTS staff_password_prev TEXT;
