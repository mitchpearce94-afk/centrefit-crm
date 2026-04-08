-- Dedicated electrician cost field on quotes (sell = cost × 1.3)
ALTER TABLE public.quotes ADD COLUMN IF NOT EXISTS electrician_cost NUMERIC DEFAULT 0;
