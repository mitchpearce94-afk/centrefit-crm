-- Builder billing + mandate notification + job progress
-- (docs/job-lifecycle-CONTEXT.md, locked 2026-11-05). Applied to prod via MCP.

-- D1: the builder lives on the site, beside the owner.
alter table customer_sites
  add column if not exists builder_name text,
  add column if not exists builder_abn text,
  add column if not exists builder_contact_name text,
  add column if not exists builder_email text,
  add column if not exists builder_phone text,
  add column if not exists builder_address text,
  add column if not exists builder_xero_contact_id text,
  add column if not exists builder_notes text;

-- D2: bill-to party per invoice, defaulting from the quote.
alter table invoices
  add column if not exists bill_to_party text not null default 'owner';
alter table invoices drop constraint if exists invoices_bill_to_party_check;
alter table invoices
  add constraint invoices_bill_to_party_check check (bill_to_party in ('owner', 'builder'));

alter table quotes
  add column if not exists bill_to_party text not null default 'owner';
alter table quotes drop constraint if exists quotes_bill_to_party_check;
alter table quotes
  add constraint quotes_bill_to_party_check check (bill_to_party in ('owner', 'builder'));

-- D4: mandates awaiting signature get their own notification type.
insert into notification_types (code, label, category, description, default_enabled, priority, email_enabled, push_enabled, sort_order)
select 'recurring_plan.awaiting_signature', 'Mandates awaiting signature', 'Billing',
       'Daily: recurring plans sent to the customer but not signed, plus drafts never sent. Chase the signup or cancel the plan.',
       true, 'high', true,
       coalesce((select push_enabled from notification_types where code = 'billing.gap'), false),
       coalesce((select sort_order from notification_types where code = 'billing.gap'), 91) + 1
where not exists (select 1 from notification_types where code = 'recurring_plan.awaiting_signature');

-- D5: manual ticks / N/A on lifecycle steps.
create table if not exists job_progress_items (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references jobs(id) on delete cascade,
  step_key text not null,
  state text not null check (state in ('done', 'na')),
  done_by_staff_id uuid references staff(id) on delete set null,
  done_by_text text,
  done_at timestamptz not null default now(),
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (job_id, step_key)
);
create index if not exists idx_job_progress_job on job_progress_items(job_id);

alter table job_progress_items enable row level security;
drop policy if exists "job_progress_select" on job_progress_items;
create policy "job_progress_select" on job_progress_items for select to authenticated using (true);
drop policy if exists "job_progress_insert" on job_progress_items;
create policy "job_progress_insert" on job_progress_items for insert to authenticated with check (has_permission('jobs.update_status'));
drop policy if exists "job_progress_update" on job_progress_items;
create policy "job_progress_update" on job_progress_items for update to authenticated using (has_permission('jobs.update_status')) with check (has_permission('jobs.update_status'));
drop policy if exists "job_progress_delete" on job_progress_items;
create policy "job_progress_delete" on job_progress_items for delete to authenticated using (has_permission('jobs.update_status'));

drop trigger if exists set_updated_at on job_progress_items;
create trigger set_updated_at before update on job_progress_items
  for each row execute function handle_updated_at();
