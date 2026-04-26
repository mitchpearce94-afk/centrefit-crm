-- =============================================================================
-- "None / consumable" sentinel rows for scope_role + labour_code
-- =============================================================================
-- Lets us make scope_role + labour_code required at product creation without
-- breaking products that legitimately have no SoW representation or no
-- separate labour line (cabling boxes, brackets, faceplates, accessories,
-- subscriptions). These sentinel rows are picked explicitly when nothing
-- else applies.
-- =============================================================================

-- scope_role "none": rendered as Miscellaneous block (is_handled_in_generator=false)
INSERT INTO public.quote_scope_roles (slug, label, description, is_handled_in_generator, sort_order)
VALUES ('none', 'None / consumable', 'Use for consumables, accessories, brackets, faceplates, or items with no dedicated SoW system block. Lands in the Miscellaneous block on quotes.', false, -1)
ON CONFLICT (slug) DO NOTHING;

-- labour_code "none": no labour minutes — used for products that don't add
-- a separate labour line (cabling, accessories, subscriptions).
INSERT INTO public.labour_timings (code, name, minutes_per, category, sort_order)
VALUES ('none', 'None / no separate labour', 0, 'none', -1)
ON CONFLICT (code) DO NOTHING;
