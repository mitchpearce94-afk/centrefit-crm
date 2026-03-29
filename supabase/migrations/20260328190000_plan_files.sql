-- Plan Builder files stored in the CRM
-- When Plan Builder is fully integrated, it saves directly here.
-- Until then, .cfq files can be uploaded via the quote wizard.

CREATE TABLE public.plan_files (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL, -- e.g. "Snap Fitness Pimpama - Rev B"
  client_name TEXT,
  site_name TEXT,
  site_address TEXT,
  device_counts JSONB NOT NULL DEFAULT '{}',
  site_info JSONB NOT NULL DEFAULT '{}',
  floor_data JSONB, -- per-floor breakdown if available
  raw_data JSONB, -- full .cfq content for reference
  quote_id UUID REFERENCES public.quotes(id), -- linked when used in a quote
  customer_id UUID REFERENCES public.customers(id),
  uploaded_by UUID,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_plan_files_quote_id ON public.plan_files(quote_id);

ALTER TABLE public.plan_files ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated users can manage plan files"
  ON public.plan_files FOR ALL TO authenticated USING (true) WITH CHECK (true);
