-- Link a catalogue product to the asset_types row it becomes when installed.
-- Drives the BOM->assets auto-import: only products mapped to a TRACKABLE asset
-- type create asset shells (cable, mounts, consumables stay out of the register).
alter table public.quote_products
  add column if not exists asset_type_id uuid references public.asset_types(id) on delete set null;

comment on column public.quote_products.asset_type_id is
  'Optional FK to asset_types — the asset this product becomes when installed. BOM->assets import only creates shells for products mapped to a trackable asset type.';

create index if not exists quote_products_asset_type_id_idx
  on public.quote_products (asset_type_id) where asset_type_id is not null;
