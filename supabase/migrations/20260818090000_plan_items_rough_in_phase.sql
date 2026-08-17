-- New-build plans get two tick phases (Mitchell 2026-08-18): rough-in the
-- cable run, later fit off the device. roughed_in_* is the earlier tick;
-- the existing status/installed_* columns remain the fit-off (or single-
-- phase) tick, so existing data and non-new-build jobs are untouched.
alter table plan_items add column roughed_in_at timestamptz;
alter table plan_items add column roughed_in_by uuid references staff(id) on delete set null;
