-- Add quote type and payment tracking
ALTER TABLE public.quotes ADD COLUMN IF NOT EXISTS quote_type TEXT NOT NULL DEFAULT 'full'; -- 'full' or 'progress'
ALTER TABLE public.quotes ADD COLUMN IF NOT EXISTS pp1_paid BOOLEAN DEFAULT false;
ALTER TABLE public.quotes ADD COLUMN IF NOT EXISTS pp2_paid BOOLEAN DEFAULT false;
ALTER TABLE public.quotes ADD COLUMN IF NOT EXISTS pp1_paid_at TIMESTAMPTZ;
ALTER TABLE public.quotes ADD COLUMN IF NOT EXISTS pp2_paid_at TIMESTAMPTZ;
ALTER TABLE public.quotes ADD COLUMN IF NOT EXISTS sent_at TIMESTAMPTZ;
ALTER TABLE public.quotes ADD COLUMN IF NOT EXISTS accepted_at TIMESTAMPTZ;
