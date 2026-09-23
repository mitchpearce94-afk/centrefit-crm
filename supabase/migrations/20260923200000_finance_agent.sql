-- Finance agent (docs/finance-CONTEXT.md). Mitchell-only section of the CRM
-- that reconciles GoCardless payouts against Xero, keeps a local Xero mirror,
-- and records every decision. Applied via Supabase MCP apply_migration 2026-09-23.

create table if not exists public.finance_settings (
  id int primary key default 1 check (id = 1),
  gc_payouts_mode text not null default 'dry_run' check (gc_payouts_mode in ('off','dry_run','live')),
  stripe_verify_mode text not null default 'off' check (stripe_verify_mode in ('off','dry_run','live')),
  draft_bills_mode text not null default 'off' check (draft_bills_mode in ('off','dry_run','live')),
  paused boolean not null default false,
  bank_account_code text not null default '602',
  fee_account_code text not null default '446',
  fee_tax_type text not null default 'INPUT',
  fee_contact_name text not null default 'GoCardless',
  match_window_days int not null default 21,
  ingest_since date not null default '2026-07-01',
  xero_day_floor int not null default 1500,
  viewer_staff_ids uuid[] not null default '{}',
  last_run_at timestamptz,
  last_run_report jsonb,
  updated_at timestamptz not null default now(),
  updated_by uuid
);
insert into public.finance_settings (id) values (1) on conflict (id) do nothing;

create table if not exists public.finance_xero_contacts (
  contact_id uuid primary key,
  name text not null,
  status text,
  email text,
  is_customer boolean,
  updated_utc timestamptz,
  raw jsonb,
  synced_at timestamptz not null default now()
);
create index if not exists finance_xero_contacts_name_idx on public.finance_xero_contacts (lower(name));

create table if not exists public.finance_xero_invoices (
  invoice_id uuid primary key,
  invoice_number text,
  contact_id uuid,
  contact_name text,
  type text,
  status text,
  date date,
  due_date date,
  total numeric(12,2),
  amount_due numeric(12,2),
  amount_paid numeric(12,2),
  reference text,
  updated_utc timestamptz,
  raw jsonb,
  synced_at timestamptz not null default now()
);
create index if not exists finance_xero_invoices_contact_date_idx on public.finance_xero_invoices (contact_id, date);
create index if not exists finance_xero_invoices_total_idx on public.finance_xero_invoices (total);

create table if not exists public.finance_gc_customers (
  gc_customer_id text primary key,
  gc_name text,
  gc_email text,
  site_id uuid references public.customer_sites(id) on delete set null,
  customer_id uuid references public.customers(id) on delete set null,
  xero_contact_id uuid,
  canonical_name text,
  status text not null default 'unlinked' check (status in ('unlinked','proposed','linked','ignored')),
  evidence jsonb not null default '{}'::jsonb,
  decided_by uuid,
  decided_at timestamptz,
  updated_at timestamptz not null default now()
);

create table if not exists public.finance_payouts (
  id uuid primary key default gen_random_uuid(),
  provider text not null check (provider in ('gocardless','stripe')),
  provider_payout_id text not null,
  arrival_date date not null,
  currency text not null default 'AUD',
  net_cents bigint not null,
  fee_cents bigint not null default 0,
  gross_cents bigint not null default 0,
  status text not null default 'new' check (status in ('new','planned','posted','reconciled','exception','skipped')),
  items_total int not null default 0,
  items_matched int not null default 0,
  plan jsonb,
  posted jsonb,
  exception text,
  planned_at timestamptz,
  posted_at timestamptz,
  reconciled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider, provider_payout_id)
);

create table if not exists public.finance_payout_items (
  id uuid primary key default gen_random_uuid(),
  payout_id uuid not null references public.finance_payouts(id) on delete cascade,
  provider_payment_id text not null,
  item_type text not null,
  amount_cents bigint not null,
  charge_date date,
  description text,
  gc_subscription_id text,
  gc_mandate_id text,
  gc_customer_id text,
  plan_id uuid,
  site_id uuid,
  xero_contact_id uuid,
  xero_contact_name text,
  xero_invoice_id uuid,
  invoice_number text,
  invoice_ids uuid[],
  match_status text not null default 'unmatched' check (match_status in ('matched','matched_manual','already_paid','no_contact','no_invoice','ambiguous','unmatched','fee','refund','skipped')),
  match_note text,
  xero_payment_id uuid,
  resolved_by uuid,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  unique (payout_id, provider_payment_id, item_type)
);
create index if not exists finance_payout_items_payout_idx on public.finance_payout_items (payout_id);

create table if not exists public.finance_review_items (
  id uuid primary key default gen_random_uuid(),
  kind text not null,
  title text not null,
  evidence jsonb not null default '{}'::jsonb,
  payout_id uuid references public.finance_payouts(id) on delete cascade,
  payout_item_id uuid references public.finance_payout_items(id) on delete cascade,
  gc_customer_id text,
  status text not null default 'open' check (status in ('open','resolved','dismissed')),
  resolution jsonb,
  resolved_by uuid,
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index if not exists finance_review_items_open_item_idx on public.finance_review_items (kind, payout_item_id) where status = 'open' and payout_item_id is not null;
create unique index if not exists finance_review_items_open_customer_idx on public.finance_review_items (kind, gc_customer_id) where status = 'open' and gc_customer_id is not null and payout_item_id is null;

create table if not exists public.finance_agent_actions (
  id bigserial primary key,
  at timestamptz not null default now(),
  actor text not null default 'agent',
  action text not null,
  entity text,
  entity_id text,
  before jsonb,
  after jsonb,
  rule text,
  note text
);
create index if not exists finance_agent_actions_at_idx on public.finance_agent_actions (at desc);

create table if not exists public.finance_daily_notes (
  date date primary key,
  body text not null,
  stats jsonb,
  created_at timestamptz not null default now()
);

-- Access: Mitchell's login, or a staff id on the allowlist (D1). Service role bypasses RLS.
create or replace function public.is_finance_viewer()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    lower(coalesce(auth.jwt() ->> 'email', '')) = 'mitchell@centrefit.com.au'
    or auth.uid() = any (coalesce((select viewer_staff_ids from public.finance_settings where id = 1), '{}'::uuid[])),
    false
  );
$$;

do $$
declare t text;
begin
  foreach t in array array['finance_settings','finance_xero_contacts','finance_xero_invoices','finance_gc_customers','finance_payouts','finance_payout_items','finance_review_items','finance_agent_actions','finance_daily_notes'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists finance_viewer_select on public.%I', t);
    execute format('create policy finance_viewer_select on public.%I for select to authenticated using (public.is_finance_viewer())', t);
    execute format('drop policy if exists finance_viewer_write on public.%I', t);
    execute format('create policy finance_viewer_write on public.%I for all to authenticated using (public.is_finance_viewer()) with check (public.is_finance_viewer())', t);
  end loop;
end $$;
