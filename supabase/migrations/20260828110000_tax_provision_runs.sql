-- Weekly tax set-aside runs (Mitchell 2026-08-28). One row per Friday cron
-- run. The park recommendation is CATCH-UP based: each run recomputes the
-- quarter-to-date target fresh from Xero (so late bank reconciliation
-- self-corrects) and recommends target minus what previous runs already told
-- Mitchell to park. Service-role only (RLS on, no policies).
-- Interim until the accountant starts — drop the cron, keep the history.
create table if not exists public.tax_provision_runs (
  id uuid primary key default gen_random_uuid(),
  run_date date not null,
  quarter_start date not null,
  qtd_cash_in numeric(12, 2) not null,
  qtd_cash_out numeric(12, 2) not null,
  qtd_gst_net numeric(12, 2) not null,
  qtd_income_tax numeric(12, 2) not null,
  qtd_target numeric(12, 2) not null,
  park_recommended numeric(12, 2) not null,
  created_at timestamptz not null default now()
);
create index if not exists tax_provision_runs_quarter_idx on public.tax_provision_runs (quarter_start, run_date);
alter table public.tax_provision_runs enable row level security;
