-- Electrician scope toggles for interstate jobs
ALTER TABLE public.quotes ADD COLUMN IF NOT EXISTS elec_doing_rough_in BOOLEAN DEFAULT false;
ALTER TABLE public.quotes ADD COLUMN IF NOT EXISTS elec_doing_fit_off BOOLEAN DEFAULT false;
