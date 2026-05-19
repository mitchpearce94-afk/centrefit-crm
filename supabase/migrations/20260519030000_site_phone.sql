-- Sue suggestion 2026-05-19: add a phone number field to sites so the
-- main reception/site contact number lives on the site itself, separate
-- from the per-contact phone numbers on customer_contacts.

ALTER TABLE public.customer_sites
  ADD COLUMN IF NOT EXISTS phone TEXT;
