-- Electrician-supplied materials. Rules flagged with a phase are skipped
-- during BOM generation when the electrician is covering that phase on the
-- quote (quotes.elec_doing_rough_in / quotes.elec_doing_fit_off), so the
-- materials the sparky supplies (cable rolls, faceplates) drop off the BOM
-- the same way their labour already drops off the labour engine.
ALTER TABLE public.quote_dependency_rules
  ADD COLUMN IF NOT EXISTS elec_supplied_phase TEXT
  CHECK (elec_supplied_phase IN ('rough_in', 'fit_off'));
