-- Email triage engine (assistant-CONTEXT.md D5–D7): audit ledger + per-mailbox
-- sweep watermarks. Service-role only — no staff-facing RLS policies; the
-- ledger is surfaced through the morning digest and My List tasks.

create table if not exists public.email_triage (
  id uuid primary key default gen_random_uuid(),
  mailbox text not null,
  graph_message_id text not null,
  internet_message_id text,
  received_at timestamptz not null,
  from_address text,
  from_name text,
  subject text,
  classification text not null
    check (classification in ('bill', 'action', 'fyi', 'noise')),
  reason text,
  bill_supplier text,
  -- What actually happened: 'observed' (dry run), 'forwarded_to_xero',
  -- 'task_created', 'categorised', 'error'.
  action_taken text not null,
  task_id uuid references public.personal_tasks(id) on delete set null,
  error text,
  created_at timestamptz not null default now()
);

create unique index if not exists email_triage_msg_uq
  on public.email_triage (mailbox, graph_message_id);

create index if not exists email_triage_created_idx
  on public.email_triage (created_at desc);

alter table public.email_triage enable row level security;

create table if not exists public.email_triage_state (
  mailbox text primary key,
  last_swept_at timestamptz not null,
  updated_at timestamptz not null default now()
);

alter table public.email_triage_state enable row level security;
