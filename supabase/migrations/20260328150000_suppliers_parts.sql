-- Suppliers — 529 to migrate from Tradify
CREATE TABLE public.suppliers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  contact_name TEXT,
  phone TEXT,
  email TEXT,
  address TEXT,
  suburb TEXT,
  state TEXT,
  postcode TEXT,
  website TEXT,
  account_number TEXT,
  notes TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_suppliers_name ON public.suppliers(name);

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.suppliers
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

ALTER TABLE public.suppliers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "suppliers_select" ON public.suppliers FOR SELECT TO authenticated USING (true);
CREATE POLICY "suppliers_insert" ON public.suppliers FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "suppliers_update" ON public.suppliers FOR UPDATE TO authenticated USING (true);
CREATE POLICY "suppliers_delete" ON public.suppliers FOR DELETE TO authenticated USING (public.is_admin());

-- Parts catalogue
CREATE TABLE public.parts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_id UUID REFERENCES public.suppliers(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  sku TEXT,
  description TEXT,
  unit_cost NUMERIC(10,2),
  sell_price NUMERIC(10,2),
  stock_qty INTEGER DEFAULT 0,
  reorder_point INTEGER DEFAULT 0,
  category TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_parts_supplier ON public.parts(supplier_id);
CREATE INDEX idx_parts_sku ON public.parts(sku);

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.parts
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

ALTER TABLE public.parts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "parts_select" ON public.parts FOR SELECT TO authenticated USING (true);
CREATE POLICY "parts_insert" ON public.parts FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "parts_update" ON public.parts FOR UPDATE TO authenticated USING (true);
CREATE POLICY "parts_delete" ON public.parts FOR DELETE TO authenticated USING (public.is_admin());
