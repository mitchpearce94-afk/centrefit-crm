-- Procurement Phase C: stock ordering module.
--
-- Flow (per 06-PROJECTS/Centrefit-CRM-Procurement-Phase-C.md):
--   1. Staff clicks "Start Ordering" on a job → populate job_procurement_items
--      from the quote BOM (one row per line with default supplier + qty).
--   2. Staff flags each row IN STOCK (fulfilled from shed, no Xero action) or
--      ORDER (queued for PO generation). Qty can be split per row.
--   3. Staff can override the supplier per row (bulk-buy from China, stock
--      shortage, etc.) and add a backorder note.
--   4. "Generate Draft POs" groups ORDER rows by actual supplier and creates
--      one draft Xero PO per supplier. xero_po_id stored back per row.
--   5. Mitchell reviews + sends each PO from Xero.
--   6. On delivery, staff flips status to RECEIVED — stamps received_at +
--      received_by for accountability (post-Sue).

-- Suppliers need a Xero Contact link so we can create POs against them.
alter table public.suppliers
  add column if not exists xero_contact_id text null;

comment on column public.suppliers.xero_contact_id is
  'Xero ContactID for this supplier. Set on first PO generation via find-or-create.';

create table if not exists public.job_procurement_items (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs(id) on delete cascade,
  quote_line_item_id uuid references public.quote_line_items(id) on delete set null,
  product_id uuid references public.quote_products(id) on delete set null,

  -- Denormalised so rows survive product renames/deletions
  product_name text not null,
  sku text null,

  -- Supplier assignment. default_supplier_id = the product's usual supplier
  -- at init time. actual_supplier_id = staff override (starts equal).
  default_supplier_id uuid references public.suppliers(id) on delete set null,
  actual_supplier_id uuid references public.suppliers(id) on delete set null,

  quantity numeric not null check (quantity > 0),

  -- pending → in_stock | order → ordered → received
  -- pending = freshly initialised, staff hasn't triaged yet
  -- in_stock = fulfilling from shed, never goes to Xero
  -- order = queued for PO generation
  -- ordered = PO has been created in Xero
  -- received = physical stock has arrived
  status text not null default 'pending'
    check (status in ('pending', 'in_stock', 'order', 'ordered', 'received')),

  backorder_note text null,

  -- Xero integration
  xero_po_id text null,
  xero_po_number text null,

  -- Lifecycle stamps
  ordered_at timestamptz null,
  received_at timestamptz null,
  received_by uuid references public.staff(id) on delete set null,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists job_procurement_items_job_id_idx
  on public.job_procurement_items (job_id);
create index if not exists job_procurement_items_status_idx
  on public.job_procurement_items (status);
create index if not exists job_procurement_items_xero_po_idx
  on public.job_procurement_items (xero_po_id) where xero_po_id is not null;

-- Auto-update updated_at on row changes
create or replace function public.set_updated_at_timestamp()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists job_procurement_items_set_updated_at
  on public.job_procurement_items;
create trigger job_procurement_items_set_updated_at
  before update on public.job_procurement_items
  for each row execute function public.set_updated_at_timestamp();

alter table public.job_procurement_items enable row level security;

-- Any authenticated user (i.e. logged into the CRM) can read/write procurement
-- rows. Customer-facing (anon) requests have no access. Matches the pattern
-- used elsewhere in the CRM — staff-scoped tables rely on "is logged in"
-- rather than a per-staff row linkage.
create policy job_procurement_items_authed_all on public.job_procurement_items
  for all
  to authenticated
  using (true)
  with check (true);
