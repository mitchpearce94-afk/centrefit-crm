-- Job "Updates" box: an internal, interim progress/info field on a job.
-- Distinct from `description` (which feeds the Scope of Works onto invoices) —
-- `updates` is NEVER pushed to a customer invoice. Free text, edited by staff
-- as a job progresses. Requested by Mitchell 2026-06-30.
alter table jobs add column if not exists updates text;

comment on column jobs.updates is
  'Internal interim progress notes for staff. Not shown on invoices (unlike description).';
