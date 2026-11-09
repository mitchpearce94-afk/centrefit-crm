-- Applied via Supabase MCP 9 Nov 2026 (Mitchell: responsible staff per lifecycle step, changeable; alarm panel testing checklist on the site).
create table if not exists progress_step_owners (
  step_key text primary key,
  owner text not null,
  updated_by uuid references staff(id) on delete set null,
  updated_at timestamptz not null default now()
);
alter table progress_step_owners enable row level security;
drop policy if exists "progress_owner_select" on progress_step_owners;
create policy "progress_owner_select" on progress_step_owners for select to authenticated using (true);
drop policy if exists "progress_owner_write" on progress_step_owners;
create policy "progress_owner_write" on progress_step_owners for all to authenticated using (has_permission('jobs.update_status')) with check (has_permission('jobs.update_status'));

create table if not exists job_progress_owners (
  job_id uuid not null references jobs(id) on delete cascade,
  step_key text not null,
  owner text not null,
  updated_by uuid references staff(id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (job_id, step_key)
);
alter table job_progress_owners enable row level security;
drop policy if exists "job_progress_owner_select" on job_progress_owners;
create policy "job_progress_owner_select" on job_progress_owners for select to authenticated using (true);
drop policy if exists "job_progress_owner_write" on job_progress_owners;
create policy "job_progress_owner_write" on job_progress_owners for all to authenticated using (has_permission('jobs.update_status')) with check (has_permission('jobs.update_status'));

-- Site checklists (first one: alarm panel testing). Template items live in src/lib/site-checklists.ts; ticks = { "<item key>": { at, by } }.
create table if not exists site_checklists (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references customer_sites(id) on delete cascade,
  job_id uuid references jobs(id) on delete set null,
  kind text not null,
  ticks jsonb not null default '{}'::jsonb,
  notes text,
  completed_at timestamptz,
  created_by uuid references staff(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (site_id, kind)
);
create index if not exists idx_site_checklists_site on site_checklists(site_id);
alter table site_checklists enable row level security;
drop policy if exists "site_checklists_select" on site_checklists;
create policy "site_checklists_select" on site_checklists for select to authenticated using (true);
drop policy if exists "site_checklists_write" on site_checklists;
create policy "site_checklists_write" on site_checklists for all to authenticated using (has_permission('jobs.update_status')) with check (has_permission('jobs.update_status'));
drop trigger if exists set_updated_at on site_checklists;
create trigger set_updated_at before update on site_checklists for each row execute function handle_updated_at();
