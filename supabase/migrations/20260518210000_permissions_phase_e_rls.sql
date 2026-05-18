-- =============================================================================
-- Permissions Phase E — RLS defense-in-depth (2026-05-18)
-- =============================================================================
-- DO NOT APPLY TO PRODUCTION WITHOUT STAGING REVIEW.
--
-- This migration tightens RLS SELECT policies on the tables field staff
-- shouldn't see (quotes, invoices, recurring plans). Today, the route-level
-- 404 guards added in Phase C already block field staff from /quoting,
-- /invoices, /procurement, /reports via the UI. These RLS changes are
-- defense-in-depth: they make direct Supabase queries return zero rows for
-- staff without the corresponding view permission.
--
-- WHY GATED:
--   - finance_manager and project_manager have a network of read joins
--     (jobs → quotes → invoices → recurring) that need to keep working.
--     The permission map per D8 is correct on paper, but live workflows may
--     have edge cases (e.g., a PM fetching invoice metadata via a job
--     details query) that this migration would break.
--   - Mark is actively using the CRM. Apply after a staging walkthrough.
--
-- HOW TO APPLY:
--   1. Spin up staging clone of production database.
--   2. Apply this migration on staging.
--   3. Log in as finance_manager, project_manager, field_staff each.
--   4. Walk the golden paths: create quote, send invoice, mark plan paid,
--      open job detail (which transitively loads quote + invoice data),
--      run procurement receive.
--   5. If all paths work, apply to prod via `mcp__supabase__apply_migration`
--      with the same SQL.
-- =============================================================================

-- ── QUOTES ────────────────────────────────────────────────────────────────
-- Replace permissive "all authenticated" SELECT with permission-aware check.
-- Admin shortcircuits to true in has_permission(), so admin is never locked
-- out by this.

DROP POLICY IF EXISTS "quotes_select" ON public.quotes;
CREATE POLICY "quotes_select" ON public.quotes FOR SELECT TO authenticated
  USING (public.has_permission('quoting.view'));

DROP POLICY IF EXISTS "quote_line_items_select" ON public.quote_line_items;
CREATE POLICY "quote_line_items_select" ON public.quote_line_items FOR SELECT TO authenticated
  USING (public.has_permission('quoting.view'));

DROP POLICY IF EXISTS "quote_extras_select" ON public.quote_extras;
CREATE POLICY "quote_extras_select" ON public.quote_extras FOR SELECT TO authenticated
  USING (public.has_permission('quoting.view'));

-- Quote writes — INSERT requires create, UPDATE only when create OR
-- (accept_manually for the accept transition). Phase E keeps UPDATE
-- permissive and relies on Route Handler-side checks for the action-level
-- discrimination (accept vs scope edit), per D10.
DROP POLICY IF EXISTS "quotes_insert" ON public.quotes;
CREATE POLICY "quotes_insert" ON public.quotes FOR INSERT TO authenticated
  WITH CHECK (public.has_permission('quoting.create'));

-- ── INVOICES ──────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "invoices_select" ON public.invoices;
CREATE POLICY "invoices_select" ON public.invoices FOR SELECT TO authenticated
  USING (public.has_permission('invoices.view'));

-- INSERT requires invoices.view (a PM creating an invoice from a job needs
-- view, and create-from-quote is a server action that checks send/authorise
-- separately at the Route Handler layer).
DROP POLICY IF EXISTS "invoices_insert" ON public.invoices;
CREATE POLICY "invoices_insert" ON public.invoices FOR INSERT TO authenticated
  WITH CHECK (public.has_permission('invoices.view'));

-- ── RECURRING PLANS (tighten if the table exists; harmless no-op otherwise) ─
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'recurring_plans') THEN
    EXECUTE 'DROP POLICY IF EXISTS recurring_plans_select ON public.recurring_plans';
    EXECUTE 'CREATE POLICY recurring_plans_select ON public.recurring_plans
             FOR SELECT TO authenticated
             USING (public.has_permission(''invoices.view''))';
  END IF;
END $$;

-- ── PURCHASE ORDERS (procurement) ─────────────────────────────────────────
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'purchase_orders') THEN
    EXECUTE 'DROP POLICY IF EXISTS purchase_orders_select ON public.purchase_orders';
    EXECUTE 'CREATE POLICY purchase_orders_select ON public.purchase_orders
             FOR SELECT TO authenticated
             USING (public.has_permission(''procurement.view''))';
  END IF;
END $$;

-- ── ROLLBACK ────────────────────────────────────────────────────────────
-- If anything breaks in prod, the rollback is:
--   DROP POLICY IF EXISTS "quotes_select" ON public.quotes;
--   CREATE POLICY "quotes_select" ON public.quotes FOR SELECT TO authenticated USING (true);
-- and equivalent for each tightened policy above. Keep this comment so the
-- rollback path is obvious to on-call.
