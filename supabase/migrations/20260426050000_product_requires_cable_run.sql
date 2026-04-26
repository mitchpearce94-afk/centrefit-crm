-- =============================================================================
-- requires_cable_run flag per product
-- =============================================================================
-- Replaces the hardcoded labour_code set in labour-engine.ts that decided
-- which BOM lines contribute to cable-run count. Now staff can mark any
-- product as "needs a cable run during rough-in" via a checkbox in the
-- product editor — no code change needed.
--
-- Backfill: set requires_cable_run = true for products whose labour_code is
-- in the historical "needs cable" set, so existing quote calculations stay
-- consistent on the first refresh.
-- =============================================================================

ALTER TABLE public.quote_products
  ADD COLUMN IF NOT EXISTS requires_cable_run BOOLEAN NOT NULL DEFAULT false;

UPDATE public.quote_products
SET requires_cable_run = true
WHERE labour_code IN (
  'camera_plaster', 'camera_concrete',
  'pir_360_roof', 'pir_wall',
  'reed_switch',
  'duress_button', 'duress_intercom',
  'light_siren', 'rex_button',
  'tailgate_system',
  'wap',
  'speaker_roof', 'speaker_wall',
  'data_point',
  'card_reader', 'door_lock', 'alarm_keypad'
);

COMMENT ON COLUMN public.quote_products.requires_cable_run IS
  'When true, every BOM line for this product contributes its quantity to the rough-in cable-run count. Use for any product physically wired back to a head-end (cameras, PIRs, speakers, WAPs, etc.). Untick for accessories/cabling consumables/rack-mounted items.';
