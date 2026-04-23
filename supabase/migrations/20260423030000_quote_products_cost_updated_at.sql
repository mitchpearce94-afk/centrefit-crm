-- Track when a product's catalog cost_price was last updated so we can:
--  (a) skip RFQ sends for products priced in the last 30 days (already fresh)
--  (b) surface "price last confirmed N days ago" hints in the UI later
--
-- Populated by the supplier-pricing confirmation flow on quote detail pages:
-- when Mitchell confirms a quote-line cost_price, we also patch the linked
-- quote_products row with the same cost + this timestamp so future quotes
-- use the fresh price without needing another RFQ round.

alter table public.quote_products
  add column if not exists cost_updated_at timestamptz null;

comment on column public.quote_products.cost_updated_at is
  'When the catalog cost_price was last confirmed by a supplier. Used to skip RFQs for products priced within 30 days. NULL = never tracked (treat as stale).';
