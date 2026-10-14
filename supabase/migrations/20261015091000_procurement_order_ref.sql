-- Procurement: supplier order number for stock bought online (Jaycar, DJ City…)
-- so Sue can note the reference against an Awaiting Delivery line without a
-- Xero PO. Staff suggestion 840A3CDB, 2026-10-15.
--
-- NOTE: the job_procurement_items.status check constraint was widened to
-- include 'ordered_online' directly on the live DB (via MCP, no repo
-- migration) — deliberately NOT touched here.
alter table public.job_procurement_items
  add column if not exists order_ref text;

comment on column public.job_procurement_items.order_ref is
  'Supplier/online order number (e.g. Jaycar, DJ City) for lines ordered without a Xero PO. Free text, editable at any status.';
