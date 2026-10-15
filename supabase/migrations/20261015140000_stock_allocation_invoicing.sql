-- Allocate stock to a job from the Inventory page, and bill it automatically
-- (Mitchell 2026-10-15): "a button for Sue to click, that she can allocate
-- stock to a job and then it automatically adds that stock to the invoice
-- when the invoice is created. I don't want to rely on the techs."
--
-- An allocation is a job_procurement_items row inserted as status in_stock,
-- so the existing inventory trigger (docs/inventory-CONTEXT.md D4) is the one
-- and only decrement path. These columns tell the invoice builder which rows
-- are billable extras and stop them being billed twice.
-- (Applied to prod via the Supabase management API; file kept for the record.)

alter table public.job_procurement_items
  add column if not exists allocated_from_stock boolean not null default false;
alter table public.job_procurement_items
  add column if not exists allocated_by uuid references public.staff(id) on delete set null;
alter table public.job_procurement_items
  add column if not exists invoiced_at timestamptz;
alter table public.job_procurement_items
  add column if not exists invoice_id uuid references public.invoices(id) on delete set null;

comment on column public.job_procurement_items.allocated_from_stock is
  'Taken from the cupboard via Inventory → Allocate (not ordered for the job). Billed as a line on the next invoice unless it fulfilled a quoted part.';
comment on column public.job_procurement_items.allocated_by is 'Who allocated it from stock (Inventory → Allocate).';
comment on column public.job_procurement_items.invoiced_at is 'When this part was put on an invoice from the job invoice builder (null = still to bill).';
comment on column public.job_procurement_items.invoice_id is 'The CRM invoice that billed this part.';

create index if not exists job_procurement_items_unbilled_stock_idx
  on public.job_procurement_items (job_id)
  where allocated_from_stock and invoiced_at is null;
