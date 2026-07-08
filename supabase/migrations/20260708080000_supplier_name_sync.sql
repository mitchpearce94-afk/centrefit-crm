-- Supplier separation follow-up (products-CONTEXT.md D9, 2026-07-08).
-- The Seadan flip updated quote_products.supplier_id in bulk and the
-- denormalised supplier TEXT column silently kept saying "Electrocraft" —
-- the offers trigger only refreshes the name when fired from the offer side.
-- Root fix: a BEFORE trigger derives the text from supplier_id on every
-- write, so no code path can ever drift the two again. UI stops reading the
-- text column entirely; this keeps legacy readers (quote engine snapshots,
-- PO generation) correct until the column is dropped.

create or replace function sync_supplier_name()
returns trigger
language plpgsql
as $$
begin
  if new.supplier_id is not null then
    new.supplier := coalesce(
      (select name from suppliers where id = new.supplier_id),
      new.supplier
    );
  end if;
  return new;
end;
$$;

drop trigger if exists quote_products_supplier_name_sync on quote_products;
create trigger quote_products_supplier_name_sync
before insert or update of supplier_id
on quote_products
for each row execute function sync_supplier_name();

-- One-off repair of any rows that drifted before this trigger existed
-- (the 2026-07-08 Seadan rows were already fixed by hand; this catches
-- anything else).
update quote_products qp
set supplier = s.name
from suppliers s
where s.id = qp.supplier_id
  and qp.supplier is distinct from s.name;
