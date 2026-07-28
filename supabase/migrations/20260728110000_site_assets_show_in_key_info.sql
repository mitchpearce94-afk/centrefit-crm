-- Per-asset opt-in to the site Key Information tab. Inclusion was purely
-- type-level (asset_types.is_key_info); one-off items on generic types
-- (e.g. an "Other" WiFi controller) had no way in — Michael 2026-07-27.
-- Applied to remote 2026-07-28 via MCP; file kept for the record.
ALTER TABLE public.site_assets
  ADD COLUMN IF NOT EXISTS show_in_key_info BOOLEAN NOT NULL DEFAULT false;

-- Reactivate the WAP Controller type (deactivated in the 2026-07-13 rename,
-- which silently removed it from the asset-type dropdowns).
UPDATE public.asset_types SET is_active = true WHERE slug = 'wifi_controller';
