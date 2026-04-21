-- =============================================================================
-- Xero integration — OAuth token storage + product → Xero Item mapping
-- =============================================================================

-- 1. XERO_CONNECTIONS
-- Stores OAuth tokens per Xero tenant. Single-tenant expected for Centrefit;
-- table supports multi-tenant if we ever need it.
CREATE TABLE IF NOT EXISTS public.xero_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id TEXT NOT NULL UNIQUE,          -- Xero tenantId (orgs under this user's login)
  tenant_name TEXT,                        -- Display name
  tenant_type TEXT,                        -- "ORGANISATION"
  access_token TEXT NOT NULL,
  refresh_token TEXT NOT NULL,
  id_token TEXT,
  expires_at TIMESTAMPTZ NOT NULL,         -- when access_token dies
  scopes TEXT,                             -- space-separated scopes granted
  last_sync_at TIMESTAMPTZ,
  last_sync_result JSONB,                  -- { synced: n, created: n, updated: n, errors: [...] }
  connected_by UUID REFERENCES public.staff(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.xero_connections ENABLE ROW LEVEL SECURITY;

-- Only admins can see tokens — tokens are sensitive
CREATE POLICY "xero_connections_select" ON public.xero_connections
  FOR SELECT TO authenticated USING (public.is_admin());
CREATE POLICY "xero_connections_insert" ON public.xero_connections
  FOR INSERT TO authenticated WITH CHECK (public.is_admin());
CREATE POLICY "xero_connections_update" ON public.xero_connections
  FOR UPDATE TO authenticated USING (public.is_admin());
CREATE POLICY "xero_connections_delete" ON public.xero_connections
  FOR DELETE TO authenticated USING (public.is_admin());

-- 2. QUOTE_PRODUCTS.XERO_ITEM_ID
-- Tracks the Xero Item UUID once a product has been pushed, so subsequent
-- syncs update rather than duplicate.
ALTER TABLE public.quote_products
  ADD COLUMN IF NOT EXISTS xero_item_id TEXT,
  ADD COLUMN IF NOT EXISTS xero_synced_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_quote_products_xero ON public.quote_products(xero_item_id)
  WHERE xero_item_id IS NOT NULL;
