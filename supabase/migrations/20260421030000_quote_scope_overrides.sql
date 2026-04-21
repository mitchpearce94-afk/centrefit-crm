-- =============================================================================
-- Scope of Works — per-quote clause overrides.
-- JSONB shape:
--   {
--     "rough_in": { "<clause_id>": { "included"?: boolean, "text"?: string } },
--     "fit_off":  { "<clause_id>": { "included"?: boolean, "text"?: string } },
--     "notes":    { "<clause_id>": { "included"?: boolean, "text"?: string } },
--     "custom":   {
--       "rough_in"?: [{ "id": string, "text": string }],
--       "fit_off"?:  [{ "id": string, "text": string }],
--       "notes"?:    [{ "id": string, "text": string }]
--     }
--   }
-- Missing/null means "use auto-generated clauses as-is".
-- =============================================================================

ALTER TABLE public.quotes
ADD COLUMN IF NOT EXISTS scope_overrides JSONB;

COMMENT ON COLUMN public.quotes.scope_overrides IS
  'Per-quote Scope of Works overrides. See generateScopeDocument() in src/lib/quote-engine/scope-of-works.ts for shape.';
