-- Asset register units per product (Mitchell 2026-10-19: "when a Veyla
-- product is ordered, populate the asset list with the server/camera and
-- their SNs; if it's access, the controller as well").
--
-- quote_products.asset_type_id says "this product IS one trackable asset".
-- A kit (Veyla Protect kit = AI server + camera) yields several, with their
-- own type/make/model. product_asset_units lists them; products with no rows
-- fall back to asset_type_id as before. Read by the BOM→assets import and by
-- procurement Receive, which creates/fills the site_assets rows.

create table if not exists public.product_asset_units (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.quote_products(id) on delete cascade,
  asset_type_id uuid not null references public.asset_types(id) on delete cascade,
  quantity integer not null default 1 check (quantity > 0),
  device_name text,
  manufacturer text,
  model text,
  sort_order integer not null default 100,
  created_at timestamptz not null default now()
);

create index if not exists idx_product_asset_units_product on public.product_asset_units(product_id);

alter table public.product_asset_units enable row level security;

drop policy if exists "product_asset_units_select" on public.product_asset_units;
create policy "product_asset_units_select" on public.product_asset_units
  for select to authenticated using (true);
drop policy if exists "product_asset_units_admin_write" on public.product_asset_units;
create policy "product_asset_units_admin_write" on public.product_asset_units
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- Which procurement line put the asset on the register (Receive flow), so a
-- second Receive never duplicates and the PO is traceable from the asset.
alter table public.site_assets
  add column if not exists procurement_item_id uuid references public.job_procurement_items(id) on delete set null;
create index if not exists idx_site_assets_procurement_item
  on public.site_assets(procurement_item_id) where procurement_item_id is not null;
