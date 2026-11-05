-- Many builders per site, one quote tendered to several builders
-- (docs/job-lifecycle-CONTEXT.md D9–D11, Mitchell 2026-11-05). Applied via MCP.

-- D9: builders are rows on the site, not columns.
create table if not exists site_builders (
  id uuid primary key default gen_random_uuid(),
  site_id uuid not null references customer_sites(id) on delete cascade,
  name text not null,
  abn text,
  contact_name text,
  email text,
  phone text,
  address text,
  notes text,
  xero_contact_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_site_builders_site on site_builders(site_id);
alter table site_builders enable row level security;
drop policy if exists "site_builders_select" on site_builders;
create policy "site_builders_select" on site_builders for select to authenticated using (true);
drop policy if exists "site_builders_insert" on site_builders;
create policy "site_builders_insert" on site_builders for insert to authenticated with check (has_permission('sites.edit_basic'));
drop policy if exists "site_builders_update" on site_builders;
create policy "site_builders_update" on site_builders for update to authenticated using (has_permission('sites.edit_basic')) with check (has_permission('sites.edit_basic'));
drop policy if exists "site_builders_delete" on site_builders;
create policy "site_builders_delete" on site_builders for delete to authenticated using (has_permission('sites.edit_basic'));
drop trigger if exists set_updated_at on site_builders;
create trigger set_updated_at before update on site_builders for each row execute function handle_updated_at();

-- Carry anything entered since this morning's single-builder columns.
insert into site_builders (site_id, name, abn, contact_name, email, phone, address, notes, xero_contact_id)
select id, builder_name, builder_abn, builder_contact_name, builder_email, builder_phone, builder_address, builder_notes, builder_xero_contact_id
from customer_sites where builder_name is not null;

alter table customer_sites
  drop column if exists builder_name,
  drop column if exists builder_abn,
  drop column if exists builder_contact_name,
  drop column if exists builder_email,
  drop column if exists builder_phone,
  drop column if exists builder_address,
  drop column if exists builder_xero_contact_id,
  drop column if exists builder_notes;

-- D10: one quote, several builders tendering, each with its own link.
create table if not exists quote_builders (
  id uuid primary key default gen_random_uuid(),
  quote_id uuid not null references quotes(id) on delete cascade,
  site_builder_id uuid not null references site_builders(id) on delete cascade,
  response_token text unique,
  status text not null default 'pending' check (status in ('pending', 'sent', 'accepted', 'declined', 'lost')),
  sent_at timestamptz,
  sent_to_email text,
  viewed_at timestamptz,
  responded_at timestamptz,
  followup_sent_at timestamptz,
  followup_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (quote_id, site_builder_id)
);
create index if not exists idx_quote_builders_quote on quote_builders(quote_id);
alter table quote_builders enable row level security;
drop policy if exists "quote_builders_select" on quote_builders;
create policy "quote_builders_select" on quote_builders for select to authenticated using (true);
drop policy if exists "quote_builders_insert" on quote_builders;
create policy "quote_builders_insert" on quote_builders for insert to authenticated with check (true);
drop policy if exists "quote_builders_update" on quote_builders;
create policy "quote_builders_update" on quote_builders for update to authenticated using (true) with check (true);
drop policy if exists "quote_builders_delete" on quote_builders;
create policy "quote_builders_delete" on quote_builders for delete to authenticated using (true);
drop trigger if exists set_updated_at on quote_builders;
create trigger set_updated_at before update on quote_builders for each row execute function handle_updated_at();

-- D11: the builder who accepted is the one invoiced.
alter table quotes add column if not exists accepted_builder_id uuid references site_builders(id) on delete set null;
alter table invoices add column if not exists site_builder_id uuid references site_builders(id) on delete set null;
