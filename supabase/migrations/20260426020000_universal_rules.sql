-- =============================================================================
-- Universal rules + "Default" template
-- =============================================================================
-- Adds the concept of a universal rule (fires on every quote regardless of
-- which template is selected) so cross-template behaviour like locksmith
-- By-Others bullets and FelixGate cloud subscriptions can be expressed
-- once instead of duplicated per template.
--
-- Also seeds an empty "Default" template so users can pick a clean, no-rules
-- starting point in the wizard. Snap Fitness keeps its is_default=true flag
-- so muscle-memory new-quote flow is unchanged.
-- =============================================================================

ALTER TABLE public.quote_dependency_rules
  ADD COLUMN IF NOT EXISTS is_universal BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_quote_dependency_rules_universal
  ON public.quote_dependency_rules(is_universal) WHERE is_universal = true;

COMMENT ON COLUMN public.quote_dependency_rules.is_universal IS
  'When true, this rule fires on every quote regardless of the chosen template. Use for cross-template behaviour (cabling, locksmith By-Others, subscription line items).';

-- Empty "Default" template so the wizard offers a no-rules starting point.
-- sort_order=-1 puts it first in the dropdown above all branded templates.
INSERT INTO public.quote_rule_templates (name, slug, description, is_default, sort_order)
VALUES ('Default', 'default', 'Empty template — only universal rules apply.', false, -1)
ON CONFLICT (slug) DO NOTHING;
