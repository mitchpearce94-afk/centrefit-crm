-- Priced-quotes: track supplier price confirmation at the quote line level.
--
-- Mitchell can send a "request for current pricing" email to a supplier from
-- the quote detail page. The supplier replies (via email, not in-app for MVP);
-- Mitchell types their confirmed prices back in. Lines gain a clear status:
--   - estimated       : cost_confirmed_at null, rfq_sent_at null
--   - rfq_pending     : rfq_sent_at set, cost_confirmed_at null
--   - confirmed       : cost_confirmed_at set
--
-- Derived from the combination of these two timestamps; no status column
-- needed — keeps the model simple and avoids staleness.

alter table public.quote_line_items
  add column if not exists rfq_sent_at timestamptz null,
  add column if not exists cost_confirmed_at timestamptz null;

comment on column public.quote_line_items.rfq_sent_at is
  'Last time a supplier pricing request email was sent for this line. NULL = never requested.';

comment on column public.quote_line_items.cost_confirmed_at is
  'When the cost_price was confirmed by a supplier (Mitchell enters the supplier reply). NULL = still estimated.';
