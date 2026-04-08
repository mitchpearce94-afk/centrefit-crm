-- Configurable labour timings for fit-off phase
CREATE TABLE public.labour_timings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  minutes_per INTEGER NOT NULL,
  category TEXT NOT NULL DEFAULT 'fit_off',
  sort_order INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.labour_timings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users can manage labour timings"
  ON public.labour_timings FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Seed with current values
INSERT INTO public.labour_timings (code, name, minutes_per, category, sort_order) VALUES
  ('camera_plaster', 'Camera install (plaster)', 30, 'fit_off', 1),
  ('camera_concrete', 'Camera install (concrete)', 45, 'fit_off', 2),
  ('pir_360_roof', 'PIR 360° ceiling', 20, 'fit_off', 3),
  ('pir_wall', 'PIR wall', 20, 'fit_off', 4),
  ('reed_switch', 'Reed switch', 25, 'fit_off', 5),
  ('duress_button', 'Duress button + faceplate', 40, 'fit_off', 6),
  ('duress_intercom', 'Duress intercom', 30, 'fit_off', 7),
  ('rex_button', 'REX button', 60, 'fit_off', 8),
  ('light_siren', 'External siren', 40, 'fit_off', 9),
  ('wap', 'WAP', 30, 'fit_off', 10),
  ('speaker_roof', 'Ceiling speaker', 40, 'fit_off', 11),
  ('speaker_wall', 'Wall speaker', 30, 'fit_off', 12),
  ('tailgate_system', 'Tailgate system', 90, 'fit_off', 13);
