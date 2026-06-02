-- GoCardless subscriptions for recurring plans (2026-06-02).
--
-- Until now activation created a GC mandate + a Xero RepeatingInvoice but
-- NOTHING that actually charged: no GC subscription, no GC payment. So GC had
-- a mandate but no instruction to collect, and $0 was pulled. We now create a
-- GoCardless SUBSCRIPTION against the mandate on activation (GC then does the
-- collecting). One subscription per cadence — primary (monthly) + optional
-- secondary (yearly), mirroring the xero_repeating_invoice_id pair.

alter table public.recurring_plans
  add column if not exists gc_subscription_id text,
  add column if not exists gc_subscription_secondary_id text;

-- Optional independent first-charge date for the yearly cadence (e.g. a
-- MyAlarm yearly sub migrated from the old system bills on a different date
-- than the monthly services). Null = use the plan's first_invoice_date.
alter table public.recurring_plans
  add column if not exists yearly_first_invoice_date date;
