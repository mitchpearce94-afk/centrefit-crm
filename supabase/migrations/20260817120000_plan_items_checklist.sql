-- Plan install checklist (Mitchell 2026-08-17): materialise a plan's placed
-- devices as tickable rows so techs can track install progress on site from
-- their phone. Ticks live HERE, never inside the .cfp blob — desktop saves
-- rewrite the blob wholesale and would clobber field progress.

create table plan_items (
  id uuid primary key default gen_random_uuid(),
  plan_file_id uuid not null references plan_files(id) on delete cascade,
  job_id uuid references jobs(id) on delete set null,
  floor_id text,
  floor_name text,
  instance_id text not null,      -- PlacedDevice.instanceId: stable across edits/renumbers
  device_id text not null,        -- catalogue id, e.g. camera_dome
  label text not null,            -- display snapshot, e.g. 'CAM 3'
  qty int not null default 1,
  status text not null default 'pending'
    check (status in ('pending', 'installed', 'na', 'issue')),
  installed_at timestamptz,
  installed_by uuid references staff(id) on delete set null,
  note text,
  orphaned boolean not null default false,  -- device removed in a later plan revision
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (plan_file_id, instance_id)
);

create index plan_items_plan_file_id_idx on plan_items (plan_file_id);
create index plan_items_job_id_idx on plan_items (job_id);

alter table plan_items enable row level security;

-- Field techs (plans.view) can read and tick; only plan managers create/delete.
create policy "plan_items_select" on plan_items for select to authenticated
  using ((select has_permission('plans.view')));
create policy "plan_items_update" on plan_items for update to authenticated
  using ((select has_permission('plans.view')))
  with check ((select has_permission('plans.view')));
create policy "plan_items_insert" on plan_items for insert to authenticated
  with check ((select has_permission('plans.manage')));
create policy "plan_items_delete" on plan_items for delete to authenticated
  using ((select has_permission('plans.manage')));

-- Split plan_files' FOR ALL policy: plans.view was always meant to grant
-- reading (field staff hold it), but the ALL policy demanded plans.manage
-- even for SELECT, so techs couldn't read a plan row at all.
drop policy "Authenticated users can manage plan files" on plan_files;
create policy "plan_files_select" on plan_files for select to authenticated
  using ((select has_permission('plans.view')));
create policy "plan_files_insert" on plan_files for insert to authenticated
  with check ((select has_permission('plans.manage')));
create policy "plan_files_update" on plan_files for update to authenticated
  using ((select has_permission('plans.manage')))
  with check ((select has_permission('plans.manage')));
create policy "plan_files_delete" on plan_files for delete to authenticated
  using ((select has_permission('plans.manage')));
