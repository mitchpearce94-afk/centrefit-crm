-- Product / supplier split (docs/products-CONTEXT.md, locked 2026-07-06).
-- quote_products stays the canonical catalogue; per-supplier SKU/name/cost
-- live in product_supplier_offers. The product row keeps mirroring its
-- preferred offer so the quote engine, procurement init and Xero sync are
-- untouched (D2). Triggers keep both directions in sync at the DB level so
-- bulk SQL loads (Seadan) stay consistent (D4).

create table if not exists product_supplier_offers (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references quote_products(id) on delete cascade,
  supplier_id uuid not null references suppliers(id) on delete cascade,
  supplier_sku text,
  supplier_item_name text,
  cost_price numeric not null default 0,
  cost_updated_at timestamptz,
  is_preferred boolean not null default false,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (product_id, supplier_id)
);

create index if not exists product_supplier_offers_product_idx
  on product_supplier_offers (product_id);
create index if not exists product_supplier_offers_supplier_idx
  on product_supplier_offers (supplier_id);

alter table product_supplier_offers enable row level security;

-- D8: mirror quote_products — staff read, admin write.
create policy product_supplier_offers_select on product_supplier_offers
  for select to authenticated using (true);
create policy product_supplier_offers_insert on product_supplier_offers
  for insert to authenticated with check (is_admin());
create policy product_supplier_offers_update on product_supplier_offers
  for update to authenticated using (is_admin()) with check (is_admin());
create policy product_supplier_offers_delete on product_supplier_offers
  for delete to authenticated using (is_admin());

-- ── Sync: preferred offer → product mirror ─────────────────────────────────
-- Fires when an offer becomes preferred or a preferred offer's cost/supplier
-- details change. Demotes sibling preferred offers, then mirrors cost +
-- supplier onto the product row. Depth guard stops the product-side trigger
-- from bouncing back here.
create or replace function sync_offer_to_product()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if pg_trigger_depth() > 1 then
    return new;
  end if;

  if not new.is_preferred then
    return new;
  end if;

  update product_supplier_offers
     set is_preferred = false, updated_at = now()
   where product_id = new.product_id
     and id <> new.id
     and is_preferred;

  update quote_products
     set supplier_id = new.supplier_id,
         supplier = coalesce((select name from suppliers where id = new.supplier_id), supplier),
         cost_price = new.cost_price,
         cost_updated_at = coalesce(new.cost_updated_at, now()),
         updated_at = now()
   where id = new.product_id;

  return new;
end;
$$;

create trigger product_supplier_offers_sync
after insert or update of is_preferred, cost_price, supplier_id
on product_supplier_offers
for each row execute function sync_offer_to_product();

-- ── Sync: product mirror → preferred offer ─────────────────────────────────
-- Every existing write path (product form, catalogue RFQ cost edits) writes
-- supplier_id/cost_price straight onto quote_products. Upsert that supplier's
-- offer as preferred so the offers table never drifts behind.
create or replace function sync_product_to_offer()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if pg_trigger_depth() > 1 then
    return new;
  end if;

  if new.supplier_id is null then
    return new;
  end if;

  insert into product_supplier_offers
    (product_id, supplier_id, supplier_sku, supplier_item_name,
     cost_price, cost_updated_at, is_preferred)
  values
    (new.id, new.supplier_id, new.sku, new.name,
     coalesce(new.cost_price, 0), coalesce(new.cost_updated_at, now()), true)
  on conflict (product_id, supplier_id) do update
    set cost_price = excluded.cost_price,
        cost_updated_at = excluded.cost_updated_at,
        is_preferred = true,
        updated_at = now();

  update product_supplier_offers
     set is_preferred = false, updated_at = now()
   where product_id = new.id
     and supplier_id <> new.supplier_id
     and is_preferred;

  return new;
end;
$$;

create trigger quote_products_offer_sync
after insert or update of supplier_id, cost_price
on quote_products
for each row execute function sync_product_to_offer();

-- ── Backfill: each product's current supplier+cost becomes its first,
--    preferred offer. supplier_sku/item name start as the catalogue values —
--    they were entered from supplier catalogues originally.
insert into product_supplier_offers
  (product_id, supplier_id, supplier_sku, supplier_item_name,
   cost_price, cost_updated_at, is_preferred)
select id, supplier_id, sku, name,
       coalesce(cost_price, 0), cost_updated_at, true
from quote_products
where supplier_id is not null
on conflict (product_id, supplier_id) do nothing;
