-- Glass-door mag lock count (from the plan builder's per-device Glass Door
-- tickbox) drives the armature-vs-mounting-plate dependency rules. Persisted
-- on the quote like the other site-info fields so edit + regenerate keeps it.
-- reed_switch_uncabled was plan-import-only until now (lost on edit — latent
-- cable overcount on regen); persist it the same way.
ALTER TABLE public.quotes
  ADD COLUMN IF NOT EXISTS mag_lock_glass INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS reed_switch_uncabled INTEGER DEFAULT 0;
