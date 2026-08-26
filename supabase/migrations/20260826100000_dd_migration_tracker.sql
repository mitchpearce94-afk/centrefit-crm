-- Direct-debit migration tracker (Mitchell 2026-08-26).
-- The in-house finance officer emails 10–15 invoice-paid recurring customers a
-- week onto GoCardless. Targets = legacy Xero repeating invoices (AUTHORISED,
-- ACCREC) that no CRM plan owns, synced from Xero; campaign state lives here.
-- (Apply to prod via Supabase MCP apply_migration — db push is blocked by
-- migration-history drift; file kept for the record.)

-- Sites that must never be moved to direct debit (Total Fusion rule).
alter table public.customer_sites
  add column if not exists invoice_only boolean not null default false;
comment on column public.customer_sites.invoice_only is
  'Billed by invoice only — never direct debit (e.g. Total Fusion). Auto-excludes the site from the DD migration tracker.';

create table if not exists public.dd_migration_targets (
  id uuid primary key default gen_random_uuid(),
  source text not null default 'xero_ri' check (source in ('xero_ri', 'crm_plan')),
  xero_repeating_invoice_id text unique,
  xero_contact_id text,
  xero_contact_name text,
  xero_reference text,
  xero_ri_status text,
  line_text text,
  ri_total numeric(12, 2),
  schedule_unit text,
  schedule_period integer,
  next_scheduled_date date,
  monthly_value numeric(12, 2),
  site_id uuid references public.customer_sites(id) on delete set null,
  customer_id uuid references public.customers(id) on delete set null,
  recurring_plan_id uuid references public.recurring_plans(id) on delete set null,
  contact_email text,
  status text not null default 'todo'
    check (status in ('todo', 'invited', 'mandate_pending', 'dd_live', 'ri_retired',
                      'declined', 'excluded', 'already_dd', 'ri_gone')),
  status_reason text,
  invited_at timestamptz,
  last_touch_at timestamptz,
  touch_count integer not null default 0,
  dd_live_at timestamptz,
  ri_retired_at timestamptz,
  notes text,
  last_synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists dd_migration_targets_status_idx on public.dd_migration_targets (status);
create index if not exists dd_migration_targets_site_idx on public.dd_migration_targets (site_id);
create index if not exists dd_migration_targets_plan_idx on public.dd_migration_targets (recurring_plan_id);

create table if not exists public.dd_migration_touches (
  id uuid primary key default gen_random_uuid(),
  target_id uuid not null references public.dd_migration_targets(id) on delete cascade,
  staff_id uuid references public.staff(id) on delete set null,
  channel text not null default 'email' check (channel in ('email', 'note', 'system')),
  note text,
  created_at timestamptz not null default now()
);
create index if not exists dd_migration_touches_target_idx on public.dd_migration_touches (target_id, created_at desc);
create index if not exists dd_migration_touches_created_idx on public.dd_migration_touches (created_at desc);

-- Singleton: the editable invitation email template.
create table if not exists public.dd_migration_settings (
  id uuid primary key default gen_random_uuid(),
  email_subject text not null,
  email_body text not null,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.staff(id) on delete set null
);
create unique index if not exists dd_migration_settings_singleton on public.dd_migration_settings ((true));

create or replace function public.dd_migration_set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end
$$;
drop trigger if exists dd_migration_targets_updated_at on public.dd_migration_targets;
create trigger dd_migration_targets_updated_at
  before update on public.dd_migration_targets
  for each row execute function public.dd_migration_set_updated_at();

insert into public.dd_migration_settings (email_subject, email_body)
select
  $tpl${{site_name}} — moving your Centrefit billing to direct debit$tpl$,
  $tpl$Hi {{contact_name}},

I'm {{sender_name}} from the Centrefit accounts team — I look after billing for {{site_name}}.

We're moving all of our recurring services over to direct debit, so invoices are paid automatically on their due date. No transfers to remember, and no overdue reminders from us.

Your recurring services with Centrefit:
{{services}}
Current total: ${{monthly_value}} per month (incl. GST)

Setting it up takes about two minutes — just enter your bank details here:
{{signup_link}}

Nothing changes about what you pay or when: the same amount is collected on the same cycle, and you'll still receive a tax invoice each time. The link is valid for 7 days — if it expires, reply and I'll send a fresh one.

Any questions, just reply to this email.

Thanks,
{{sender_name}}
Centrefit Group · accounts@centrefit.com.au · (07) 3188 5115$tpl$
where not exists (select 1 from public.dd_migration_settings);

alter table public.dd_migration_targets enable row level security;
alter table public.dd_migration_touches enable row level security;
alter table public.dd_migration_settings enable row level security;

drop policy if exists dd_migration_targets_select on public.dd_migration_targets;
create policy dd_migration_targets_select on public.dd_migration_targets
  for select to authenticated using (true);
drop policy if exists dd_migration_targets_insert on public.dd_migration_targets;
create policy dd_migration_targets_insert on public.dd_migration_targets
  for insert to authenticated with check (public.has_permission('invoices.manage_recurring'));
drop policy if exists dd_migration_targets_update on public.dd_migration_targets;
create policy dd_migration_targets_update on public.dd_migration_targets
  for update to authenticated
  using (public.has_permission('invoices.manage_recurring'))
  with check (public.has_permission('invoices.manage_recurring'));
drop policy if exists dd_migration_targets_delete on public.dd_migration_targets;
create policy dd_migration_targets_delete on public.dd_migration_targets
  for delete to authenticated using (public.is_admin());

drop policy if exists dd_migration_touches_select on public.dd_migration_touches;
create policy dd_migration_touches_select on public.dd_migration_touches
  for select to authenticated using (true);
drop policy if exists dd_migration_touches_insert on public.dd_migration_touches;
create policy dd_migration_touches_insert on public.dd_migration_touches
  for insert to authenticated with check (public.has_permission('invoices.manage_recurring'));
drop policy if exists dd_migration_touches_delete on public.dd_migration_touches;
create policy dd_migration_touches_delete on public.dd_migration_touches
  for delete to authenticated using (public.is_admin());

drop policy if exists dd_migration_settings_select on public.dd_migration_settings;
create policy dd_migration_settings_select on public.dd_migration_settings
  for select to authenticated using (true);
drop policy if exists dd_migration_settings_write on public.dd_migration_settings;
create policy dd_migration_settings_write on public.dd_migration_settings
  for update to authenticated
  using (public.has_permission('invoices.manage_recurring'))
  with check (public.has_permission('invoices.manage_recurring'));

-- Bell: fired by the GC webhook when a migrated customer's plan activates and
-- the legacy repeating invoice still needs retiring.
insert into notification_types (code, label, category, description, default_enabled, priority, email_enabled, push_enabled, sort_order)
select 'dd_migration.dd_live', 'Direct debit live — retire legacy repeating invoice', 'Billing',
       'A customer moved to direct debit; their old Xero repeating invoice is still authorised and must be retired to avoid double invoicing.',
       true, 'high', true, true, 62
where not exists (select 1 from notification_types where code = 'dd_migration.dd_live');
