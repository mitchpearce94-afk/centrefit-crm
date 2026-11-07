-- Promo keychain draws (first use: Lift Brands Asia Pacific Summit 2027).
-- One NFC keychain = one promo_tags row = one link https://centrefit.com.au/t/<code>.
-- Tapping before draw_at registers (one entry per tag); at draw_at one winner is
-- picked (atomic update on promo_events.drawn_at); after closes_at every link
-- redirects to redirect_url. Service-role only — RLS on, no policies.

create table if not exists public.promo_events (
  slug            text primary key,
  name            text not null,
  prize           text not null,
  draw_at         timestamptz not null,
  closes_at       timestamptz not null,
  redirect_url    text not null default 'https://www.centrefit.com.au/help',
  notify_emails   text[] not null default '{}',
  drawn_at        timestamptz,
  winner_entry_id uuid,
  draw_seed       text,
  draw_entries    integer,
  created_at      timestamptz not null default now()
);

create table if not exists public.promo_tags (
  code        text primary key,
  event_slug  text not null references public.promo_events(slug) on delete cascade,
  n           integer not null,
  created_at  timestamptz not null default now(),
  unique (event_slug, n)
);

create table if not exists public.promo_entries (
  id          uuid primary key default gen_random_uuid(),
  event_slug  text not null references public.promo_events(slug) on delete cascade,
  tag_code    text not null unique references public.promo_tags(code) on delete cascade,
  name        text not null,
  mobile      text not null,
  entered_at  timestamptz not null default now(),
  ip          text,
  user_agent  text
);

create index if not exists promo_entries_event_idx on public.promo_entries(event_slug, entered_at);

alter table public.promo_events  enable row level security;
alter table public.promo_tags    enable row level security;
alter table public.promo_entries enable row level security;
