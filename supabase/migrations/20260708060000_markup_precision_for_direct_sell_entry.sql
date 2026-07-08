-- Direct cost+sell entry for CentreFit (China-import) products needs markup
-- precise enough that a typed sell price lands exactly. markup 2dp caps
-- precision at ±0.5% of cost; 6dp is sub-cent for any realistic price.
-- sell_price is GENERATED from markup, so it is dropped and re-created
-- around the type change — same expression, values unchanged.
alter table quote_products drop column sell_price;
alter table quote_products alter column markup type numeric(10,6);
alter table quote_products add column sell_price numeric(10,2)
  generated always as (cost_price * (1 + markup)) stored;

-- Line snapshots inherit product markups; keep the same precision.
alter table quote_line_items alter column markup type numeric(10,6);
