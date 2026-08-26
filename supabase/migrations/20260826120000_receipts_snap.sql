-- Receipts "Snap" (Mitchell 2026-08-26): a one-tap receipt camera at /snap
-- with its own home-screen icon, forwarding straight to Xero's bills inbox.
-- (Apply to prod via Supabase MCP apply_migration — db push is blocked by
-- migration-history drift; file kept for the record.)

-- Where receipts go: Xero's "email bills to Xero" address for the org. When
-- set, scanned receipts are sent there (accounts@ CC'd) so Xero's own bill
-- capture turns them into draft bills; when empty we fall back to the
-- accounts mailbox as before.
alter table public.billing_settings
  add column if not exists xero_bills_email text;
comment on column public.billing_settings.xero_bills_email is
  'Xero "email bills to Xero" inbox address. Receipts are forwarded here when set (accounts mailbox CC''d).';

-- Which path captured the receipt, and where it was forwarded.
alter table public.receipts
  add column if not exists source text not null default 'scanner';
alter table public.receipts
  add column if not exists forwarded_to text;
comment on column public.receipts.source is 'scanner (desktop page) | snap (phone camera) | bulk (phone photo picker)';
