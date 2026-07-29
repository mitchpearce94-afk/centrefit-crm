-- My List — personal task inbox (assistant-CONTEXT.md D1/D2).
-- Owner-only by design: NO is_admin() escape hatch — this is a private list
-- (Mitchell, 2026-07-29). Crons write via the service-role client.

create table if not exists public.personal_tasks (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.staff(id) on delete cascade,
  title text not null,
  notes text,
  status text not null default 'open'
    check (status in ('open', 'done', 'snoozed', 'waiting')),
  due_date date,
  snoozed_until date,
  -- 'manual' or an automated source key ('digest.invoice-unsent', 'email', ...)
  source text not null default 'manual',
  -- Occurrence key for automated tasks; with source, makes upserts idempotent.
  source_ref text,
  href text,
  priority text not null default 'normal'
    check (priority in ('urgent', 'normal', 'low')),
  first_seen_at timestamptz not null default now(),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- One task per automated occurrence — includes done rows on purpose, so a
-- ticked task is never resurrected by the next cron run (D2).
create unique index if not exists personal_tasks_auto_ref_uq
  on public.personal_tasks (owner_id, source, source_ref)
  where source <> 'manual' and source_ref is not null;

create index if not exists personal_tasks_owner_status_idx
  on public.personal_tasks (owner_id, status, due_date);

alter table public.personal_tasks enable row level security;

create policy personal_tasks_select on public.personal_tasks
  for select to authenticated using (owner_id = auth.uid());
create policy personal_tasks_insert on public.personal_tasks
  for insert to authenticated with check (owner_id = auth.uid());
create policy personal_tasks_update on public.personal_tasks
  for update to authenticated
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy personal_tasks_delete on public.personal_tasks
  for delete to authenticated using (owner_id = auth.uid());
