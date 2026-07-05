-- Phase B of docs/documentation-CONTEXT.md: DocuSign-style signing requests
-- (generic — SWMS/handover reuse the same table in Phases C/D) plus the
-- structured Security Monitoring Response profile that each signed form
-- maintains on its site.

create table if not exists document_sign_requests (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references customer_sites(id) on delete cascade,
  site_document_id uuid references site_documents(id) on delete set null,
  document_type text not null default 'monitoring_form',
  token text not null unique,
  recipient_name text,
  recipient_email text not null,
  -- sent | viewed | signed | void
  status text not null default 'sent',
  version integer not null default 1,
  -- Generation-time snapshot: site/owner details, fee catalogue prices,
  -- current profile values, CF-only zone schedule. The public form renders
  -- from this snapshot so later CRM edits never mutate an in-flight form.
  prefill jsonb not null default '{}'::jsonb,
  -- Submitted answers, exactly as signed (full PINs live only here and in
  -- the stored PDF — the site profile keeps them masked).
  form_data jsonb,
  signer_name text,
  signer_position text,
  signature_data text,
  signer_ip text,
  signer_user_agent text,
  sent_at timestamptz not null default now(),
  viewed_at timestamptz,
  signed_at timestamptz,
  created_by uuid references staff(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_sign_requests_site on document_sign_requests(site_id);
create index if not exists idx_sign_requests_document on document_sign_requests(site_document_id);

alter table document_sign_requests enable row level security;

create policy sign_requests_select on document_sign_requests
  for select to authenticated using (true);
create policy sign_requests_insert on document_sign_requests
  for insert to authenticated with check (true);
-- No UPDATE/DELETE policies: view/sign transitions and voiding run through
-- service-role API routes only (same model as site_documents deletion).

create table if not exists site_monitoring_profiles (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null unique references customer_sites(id) on delete cascade,
  -- Response option selections, e.g. {"burglar":"B2","late_to_close":"L1",...}
  selections jsonb not null default '{}'::jsonb,
  -- [{"name","phone"}] — up to 8 rows.
  call_list jsonb not null default '[]'::jsonb,
  -- [{"name","pin","app_access"}] — up to 12 rows. PINs stored MASKED
  -- (e.g. "***4"); the signed PDF is the full-fidelity record.
  ifob_users jsonb not null default '[]'::jsonb,
  -- {"mon":{"open","close","cleaner","h24"},...}
  opening_hours jsonb not null default '{}'::jsonb,
  -- Everything else: nearest_cross_street, commencement_date, sim_phone, ...
  details jsonb not null default '{}'::jsonb,
  updated_from_request_id uuid references document_sign_requests(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table site_monitoring_profiles enable row level security;
create policy monitoring_profiles_select on site_monitoring_profiles
  for select to authenticated using (true);
-- Writes happen only in the service-role submit route.

insert into notification_types (code, label, category, description, default_enabled, priority, email_enabled, sort_order)
values
  ('monitoring_form.viewed', 'Monitoring form opened', 'Documents', 'Customer opened a security monitoring instructions link', true, 'low', false, 95),
  ('monitoring_form.signed', 'Monitoring form signed', 'Documents', 'Customer signed the security monitoring response instructions', true, 'high', true, 94)
on conflict (code) do nothing;
