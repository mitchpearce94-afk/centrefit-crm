-- Per-line Xero account codes on recurring services + plan items.
-- Default 200 (generic Sales) — backfill known Centrefit services to their
-- proper sales accounts so existing repeating invoices push to the right
-- ledger lines on next sync.

ALTER TABLE recurring_services
  ADD COLUMN IF NOT EXISTS account_code TEXT NOT NULL DEFAULT '200';

ALTER TABLE recurring_plan_items
  ADD COLUMN IF NOT EXISTS account_code TEXT NOT NULL DEFAULT '200';

-- Backfill catalogue codes by service `code` substring match. Best-effort —
-- anything we don't recognise stays at the safe 200 default and Mitchell can
-- correct it via the catalogue UI.
UPDATE recurring_services
SET account_code = CASE
  WHEN lower(code) LIKE '%nbn%' THEN '204'
  WHEN lower(code) LIKE '%sim%' THEN '207'
  WHEN lower(code) LIKE '%myalarm%' OR lower(code) LIKE '%my-alarm%' OR lower(code) LIKE '%my_alarm%' THEN '208'
  WHEN (lower(code) LIKE '%b2b%' OR lower(code) LIKE '%monitoring%') AND lower(code) LIKE '%year%' THEN '205'
  WHEN (lower(code) LIKE '%b2b%' OR lower(code) LIKE '%monitoring%') AND lower(code) LIKE '%quart%' THEN '205'
  WHEN (lower(code) LIKE '%b2b%' OR lower(code) LIKE '%monitoring%') THEN '209'
  WHEN lower(code) LIKE '%freight%' OR lower(code) LIKE '%shipping%' THEN '215'
  WHEN lower(code) LIKE '%callout%' THEN '201'
  WHEN lower(code) LIKE '%it-service%' OR lower(code) LIKE '%it_service%' THEN '202'
  WHEN lower(code) LIKE '%it-install%' OR lower(code) LIKE '%it_install%' THEN '203'
  WHEN lower(code) LIKE '%part%' THEN '206'
  ELSE account_code
END
WHERE account_code = '200';

-- Mirror the catalogue codes into the items snapshot so already-active plans
-- pick up the right code on next Xero sync.
UPDATE recurring_plan_items rpi
SET account_code = rs.account_code
FROM recurring_services rs
WHERE rpi.service_id = rs.id
  AND rpi.account_code = '200'
  AND rs.account_code <> '200';
