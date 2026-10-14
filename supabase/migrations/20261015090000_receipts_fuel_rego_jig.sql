-- Receipts → the accountant, not Xero's bills inbox (Mitchell 2026-10-15):
-- "get rid of the one in crm and make it send to Jig instead of bills".
-- The desktop /receipts scanner is deleted; /snap is the only capture path.
-- Every receipt email now uses one of three fixed lines:
--   Please see attached receipt - no job attached
--   Please see attached receipt - CFA05281
--   Please see attached fuel receipt - CFT003
-- (Apply to prod via the Supabase management API / MCP — db push is blocked
-- by migration-history drift; file kept for the record.)

-- Fuel receipts carry a vehicle rego instead of a job.
alter table public.receipts
  add column if not exists is_fuel boolean not null default false;
alter table public.receipts
  add column if not exists vehicle_rego text;
comment on column public.receipts.is_fuel is 'Fuel receipt (Snap "Fuel" toggle) — no job, vehicle_rego set instead.';
comment on column public.receipts.vehicle_rego is 'Vehicle rego a fuel receipt belongs to (one of billing_settings.fuel_regos).';

-- The rego list the Snap app offers. Admins edit it in Settings → Billing.
alter table public.billing_settings
  add column if not exists fuel_regos text[] not null default '{}';
comment on column public.billing_settings.fuel_regos is 'Vehicle regos offered by the Snap app''s Fuel toggle (upper-case, no spaces).';
