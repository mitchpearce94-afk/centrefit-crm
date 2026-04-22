-- Track auto-invoice attempts when a quote is accepted.
--
-- On quote accept, the CRM creates the Xero invoice automatically. These
-- columns record whether the attempt was made and any error — NULL error
-- after attempt = success.
--
-- Success is also observable via an `invoices` row with this quote_id, but
-- storing the error on the quote keeps the failure visible in the quote UI
-- without a join.

alter table public.quotes
  add column if not exists auto_invoice_attempted_at timestamptz null,
  add column if not exists auto_invoice_error text null;

comment on column public.quotes.auto_invoice_attempted_at is
  'Timestamp when the system attempted to auto-create the Xero invoice on acceptance. NULL = never attempted.';

comment on column public.quotes.auto_invoice_error is
  'Error message from the last auto-invoice attempt. NULL + attempted_at set = success.';

-- Distinguish auto-created invoices (from quote accept) from manually-created
-- ones (staff clicked Generate). Useful for audit and for surfacing in the
-- invoices list so staff know which need review before sending.
alter table public.invoices
  add column if not exists auto_created boolean not null default false;

comment on column public.invoices.auto_created is
  'TRUE if invoice was created automatically on quote acceptance. FALSE if staff clicked Generate.';
