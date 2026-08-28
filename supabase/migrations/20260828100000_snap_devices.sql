-- Snap paired devices (Mitchell 2026-08-28): the Receipts home-screen app
-- kept logging out — iOS bins script-set session cookies when the PWA
-- process dies, and the CRM's idle timeout finishes the job. A paired device
-- carries a long-lived SERVER-set httpOnly cookie ("cf-snap-device" =
-- "<id>.<secret>") minted once from an authenticated session or a passkey
-- tap; /snap and its upload API accept it in place of a session.
--
-- Service-role only: RLS on, no policies. Revoke a lost phone by deleting
-- its row.
create table if not exists public.snap_devices (
  id uuid primary key default gen_random_uuid(),
  staff_id uuid not null references public.staff(id) on delete cascade,
  token_hash text not null, -- sha256 hex of the cookie secret; the secret itself is never stored
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

create index if not exists snap_devices_staff_id_idx on public.snap_devices (staff_id);

alter table public.snap_devices enable row level security;
