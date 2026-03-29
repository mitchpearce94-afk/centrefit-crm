-- ============================================================================
-- CENTREFIT CRM — Quoting Module
-- Tables: quote_products, quote_dependency_rules, quotes,
--         quote_line_items, quote_extras
-- ============================================================================

-- ============================================================================
-- 1. QUOTE PRODUCTS — Product catalog for quoting
-- ============================================================================

CREATE TABLE public.quote_products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  sku TEXT,
  category TEXT NOT NULL, -- 'Digital Surveillance', 'Security System', 'Access Control', 'Audio System', 'Data System', 'AV System', 'Infrastructure'
  supplier TEXT NOT NULL,
  cost_price NUMERIC(10,2) NOT NULL DEFAULT 0,
  markup NUMERIC(5,2) NOT NULL DEFAULT 0.50,
  sell_price NUMERIC(10,2) GENERATED ALWAYS AS (cost_price * (1 + markup)) STORED,
  device_type TEXT, -- maps to floor plan device code: 'camera_black', 'pir_360_roof', etc.
  is_default BOOLEAN DEFAULT false,
  is_active BOOLEAN DEFAULT true,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_quote_products_category ON public.quote_products(category);
CREATE INDEX idx_quote_products_device_type ON public.quote_products(device_type);
CREATE INDEX idx_quote_products_supplier ON public.quote_products(supplier);

-- ============================================================================
-- 2. QUOTE DEPENDENCY RULES — Auto-add rules (e.g. cameras -> add NVR)
-- ============================================================================

CREATE TABLE public.quote_dependency_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  preset TEXT NOT NULL DEFAULT 'snap_fitness',
  description TEXT NOT NULL,
  is_active BOOLEAN DEFAULT true,
  trigger_code TEXT NOT NULL, -- device code or sum expression
  trigger_condition TEXT NOT NULL, -- 'always', 'greater_than', 'range', 'compound', 'site_conditional', 'site_boolean'
  trigger_value NUMERIC DEFAULT 0,
  trigger_min NUMERIC,
  trigger_max NUMERIC,
  trigger_site_field TEXT,
  trigger_site_value NUMERIC,
  trigger_site_op TEXT,
  quantity_mode TEXT NOT NULL DEFAULT 'fixed', -- 'fixed', 'match_trigger', 'match_site_field', 'per_n', 'ceil_formula', 'formula', 'custom'
  quantity_value NUMERIC DEFAULT 1,
  quantity_site_field TEXT,
  quantity_multiplier NUMERIC,
  quantity_divisor NUMERIC,
  quantity_formula TEXT, -- tiered formula e.g. '<=8:2, <=16:4, >16:6'
  quantity_custom_key TEXT, -- custom calc function key
  auto_add_product_id UUID REFERENCES public.quote_products(id),
  sort_order INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_quote_dependency_rules_preset ON public.quote_dependency_rules(preset);

-- ============================================================================
-- 3. QUOTES — Quote header
-- ============================================================================

CREATE TABLE public.quotes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ref TEXT NOT NULL, -- e.g. 'CF-2026-0001'
  customer_id UUID REFERENCES public.customers(id),
  job_id UUID REFERENCES public.jobs(id), -- linked job if quote accepted
  client_name TEXT NOT NULL,
  site_name TEXT NOT NULL,
  site_address TEXT,
  status TEXT NOT NULL DEFAULT 'draft', -- 'draft', 'sent', 'accepted', 'declined'
  -- Site info for dependency rules
  site_sqm NUMERIC,
  door_count INT DEFAULT 0,
  external_camera_count INT DEFAULT 0,
  concrete_mount_black INT DEFAULT 0,
  concrete_mount_white INT DEFAULT 0,
  cardio_count INT DEFAULT 0,
  tv_count INT DEFAULT 0,
  ceiling_tv_count INT DEFAULT 0,
  wall_tv_mount_count INT DEFAULT 0,
  ceiling_tv_mount_count INT DEFAULT 0,
  separate_studio_zone BOOLEAN DEFAULT false,
  -- Device counts stored as JSONB
  device_counts JSONB DEFAULT '{}',
  -- Labour data stored as JSONB (sections with items)
  labour_data JSONB,
  -- Pricing snapshot
  discount_percent NUMERIC(5,2) DEFAULT 0,
  pricing_snapshot JSONB, -- full calculateQuoteSummary output
  notes TEXT,
  created_by UUID,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_quotes_customer_id ON public.quotes(customer_id);
CREATE INDEX idx_quotes_status ON public.quotes(status);

-- ============================================================================
-- 4. QUOTE LINE ITEMS — BOM items per quote
-- ============================================================================

CREATE TABLE public.quote_line_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_id UUID NOT NULL REFERENCES public.quotes(id) ON DELETE CASCADE,
  product_id UUID REFERENCES public.quote_products(id),
  device_type_code TEXT,
  device_type_legend TEXT,
  category TEXT,
  product_name TEXT NOT NULL,
  sku TEXT,
  supplier TEXT,
  quantity INT NOT NULL DEFAULT 1,
  cost_price NUMERIC(10,2) DEFAULT 0,
  markup NUMERIC(5,2) DEFAULT 0.50,
  sell_price NUMERIC(10,2) DEFAULT 0,
  auto_added BOOLEAN DEFAULT false,
  rule_description TEXT,
  notes TEXT,
  sort_order INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_quote_line_items_quote_id ON public.quote_line_items(quote_id);

-- ============================================================================
-- 5. QUOTE EXTRAS — Freight, travel, etc.
-- ============================================================================

CREATE TABLE public.quote_extras (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_id UUID NOT NULL REFERENCES public.quotes(id) ON DELETE CASCADE,
  category TEXT NOT NULL, -- 'Freight', 'Travel', 'Sundries', 'Electrician'
  description TEXT NOT NULL,
  cost NUMERIC(10,2) DEFAULT 0,
  sell NUMERIC(10,2) DEFAULT 0,
  notes TEXT,
  sort_order INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_quote_extras_quote_id ON public.quote_extras(quote_id);

-- ============================================================================
-- 6. UPDATED_AT TRIGGERS
-- ============================================================================

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.quote_products
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.quotes
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- ============================================================================
-- 7. ROW LEVEL SECURITY
-- ============================================================================

-- QUOTE PRODUCTS: all authenticated can read, all can create/update, admin-only delete
ALTER TABLE public.quote_products ENABLE ROW LEVEL SECURITY;
CREATE POLICY "quote_products_select" ON public.quote_products FOR SELECT TO authenticated USING (true);
CREATE POLICY "quote_products_insert" ON public.quote_products FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "quote_products_update" ON public.quote_products FOR UPDATE TO authenticated USING (true);
CREATE POLICY "quote_products_delete" ON public.quote_products FOR DELETE TO authenticated USING (public.is_admin());

-- QUOTE DEPENDENCY RULES: all authenticated can read, all can create/update, admin-only delete
ALTER TABLE public.quote_dependency_rules ENABLE ROW LEVEL SECURITY;
CREATE POLICY "quote_dependency_rules_select" ON public.quote_dependency_rules FOR SELECT TO authenticated USING (true);
CREATE POLICY "quote_dependency_rules_insert" ON public.quote_dependency_rules FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "quote_dependency_rules_update" ON public.quote_dependency_rules FOR UPDATE TO authenticated USING (true);
CREATE POLICY "quote_dependency_rules_delete" ON public.quote_dependency_rules FOR DELETE TO authenticated USING (public.is_admin());

-- QUOTES: all authenticated can read, all can create/update, admin-only delete
ALTER TABLE public.quotes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "quotes_select" ON public.quotes FOR SELECT TO authenticated USING (true);
CREATE POLICY "quotes_insert" ON public.quotes FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "quotes_update" ON public.quotes FOR UPDATE TO authenticated USING (true);
CREATE POLICY "quotes_delete" ON public.quotes FOR DELETE TO authenticated USING (public.is_admin());

-- QUOTE LINE ITEMS: all authenticated can read/create/update/delete (cascades from quote)
ALTER TABLE public.quote_line_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "quote_line_items_select" ON public.quote_line_items FOR SELECT TO authenticated USING (true);
CREATE POLICY "quote_line_items_insert" ON public.quote_line_items FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "quote_line_items_update" ON public.quote_line_items FOR UPDATE TO authenticated USING (true);
CREATE POLICY "quote_line_items_delete" ON public.quote_line_items FOR DELETE TO authenticated USING (true);

-- QUOTE EXTRAS: all authenticated can read/create/update/delete (cascades from quote)
ALTER TABLE public.quote_extras ENABLE ROW LEVEL SECURITY;
CREATE POLICY "quote_extras_select" ON public.quote_extras FOR SELECT TO authenticated USING (true);
CREATE POLICY "quote_extras_insert" ON public.quote_extras FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "quote_extras_update" ON public.quote_extras FOR UPDATE TO authenticated USING (true);
CREATE POLICY "quote_extras_delete" ON public.quote_extras FOR DELETE TO authenticated USING (true);
