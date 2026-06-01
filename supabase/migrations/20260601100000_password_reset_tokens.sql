-- Password reset hardening (audit 2026-06-01).
--
-- The old /api/auth/forgot-password endpoint changed a user's password the
-- instant ANY email was submitted, with no confirmation step and no rate
-- limiting — an unauthenticated lockout-DoS: knowing a staff email let an
-- attacker reset (and thus invalidate) that user's password at will.
--
-- New flow: forgot-password mints a single-use, time-limited token, stores
-- only its SHA-256 hash here, and emails a link. The password is NOT changed
-- until the user clicks the link and chooses a new password themselves.
--
-- This table is touched ONLY by the service-role client. RLS is enabled with
-- NO policies, so anon/authenticated clients have zero access; the service
-- role bypasses RLS.

create table if not exists public.password_reset_tokens (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null,
  email       text not null,
  token_hash  text not null,
  expires_at  timestamptz not null,
  used_at     timestamptz,
  created_at  timestamptz not null default now()
);

create index if not exists password_reset_tokens_email_idx
  on public.password_reset_tokens (email);
create index if not exists password_reset_tokens_hash_idx
  on public.password_reset_tokens (token_hash);

alter table public.password_reset_tokens enable row level security;
-- Intentionally no policies: deny-all to client roles; service role only.
