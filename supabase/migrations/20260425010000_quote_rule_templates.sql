-- =============================================================================
-- Quote Rule Templates
-- Promotes the existing `preset` string column on quote_dependency_rules into
-- a proper table so users can name, describe, and manage rule sets per
-- customer type (Snap Fitness, Total Fusion, Anytime Fitness, etc.).
-- Each quote records which template was applied to it.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.quote_rule_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  slug TEXT NOT NULL UNIQUE,           -- legacy preset string, kept stable for code-side seeders
  description TEXT,
  is_default BOOLEAN NOT NULL DEFAULT false,
  is_active BOOLEAN NOT NULL DEFAULT true,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_quote_rule_templates_slug ON public.quote_rule_templates(slug);

-- Only one row may have is_default = true at a time.
CREATE UNIQUE INDEX IF NOT EXISTS idx_quote_rule_templates_one_default
  ON public.quote_rule_templates ((1)) WHERE is_default = true;

-- updated_at trigger
DROP TRIGGER IF EXISTS quote_rule_templates_set_updated_at ON public.quote_rule_templates;
CREATE TRIGGER quote_rule_templates_set_updated_at
  BEFORE UPDATE ON public.quote_rule_templates
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- RLS — same pattern as quote_dependency_rules: all authenticated read/write,
-- admin-only delete.
ALTER TABLE public.quote_rule_templates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "quote_rule_templates_select" ON public.quote_rule_templates
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "quote_rule_templates_insert" ON public.quote_rule_templates
  FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "quote_rule_templates_update" ON public.quote_rule_templates
  FOR UPDATE TO authenticated USING (true);
CREATE POLICY "quote_rule_templates_delete" ON public.quote_rule_templates
  FOR DELETE TO authenticated USING (public.is_admin());

-- Seed the existing presets as templates.
INSERT INTO public.quote_rule_templates (name, slug, description, is_default, sort_order)
VALUES
  ('Snap Fitness', 'snap_fitness', 'Standard Snap Fitness build — full security, AV, data, and surveillance package.', true, 0),
  ('Total Fusion', 'total_fusion', 'Total Fusion build — variant of the standard package, override per template.', false, 1)
ON CONFLICT (slug) DO NOTHING;

-- =============================================================================
-- Add template_id to quote_dependency_rules and backfill from the existing
-- preset string. Keep the preset column for now as a paper-trail — it can be
-- dropped in a follow-up once nothing reads from it.
-- =============================================================================

ALTER TABLE public.quote_dependency_rules
  ADD COLUMN IF NOT EXISTS template_id UUID REFERENCES public.quote_rule_templates(id) ON DELETE CASCADE;

UPDATE public.quote_dependency_rules r
SET template_id = t.id
FROM public.quote_rule_templates t
WHERE r.template_id IS NULL AND r.preset = t.slug;

-- Any rules whose preset doesn't match a known template land in the default
-- template so we don't lose them silently.
UPDATE public.quote_dependency_rules
SET template_id = (SELECT id FROM public.quote_rule_templates WHERE is_default = true LIMIT 1)
WHERE template_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_quote_dependency_rules_template ON public.quote_dependency_rules(template_id);

-- =============================================================================
-- Add template_id to quotes so each quote records which ruleset built its BOM.
-- Existing quotes stay NULL (they were all built off the hardcoded Snap rules).
-- New quotes will require a template_id via the wizard.
-- =============================================================================

ALTER TABLE public.quotes
  ADD COLUMN IF NOT EXISTS template_id UUID REFERENCES public.quote_rule_templates(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_quotes_template ON public.quotes(template_id);

COMMENT ON TABLE public.quote_rule_templates IS
  'Named ruleset profiles. Each quote picks one at creation, and only that template''s dependency rules are evaluated when generating its BOM.';
