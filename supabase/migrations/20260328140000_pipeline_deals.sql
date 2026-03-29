-- Pipeline deals — sales/lead tracking with kanban stages
CREATE TYPE public.deal_stage AS ENUM ('lead', 'qualified', 'quote_sent', 'negotiating', 'won', 'lost');

CREATE TABLE public.pipeline_deals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID REFERENCES public.customers(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  description TEXT,
  stage deal_stage NOT NULL DEFAULT 'lead',
  value NUMERIC(12,2),
  probability INTEGER DEFAULT 0 CHECK (probability >= 0 AND probability <= 100),
  expected_close DATE,
  contact_name TEXT,
  contact_phone TEXT,
  contact_email TEXT,
  lost_reason TEXT,
  won_job_id UUID REFERENCES public.jobs(id) ON DELETE SET NULL,
  assigned_to UUID REFERENCES public.staff(id) ON DELETE SET NULL,
  created_by UUID REFERENCES public.staff(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_pipeline_stage ON public.pipeline_deals(stage);
CREATE INDEX idx_pipeline_customer ON public.pipeline_deals(customer_id);
CREATE INDEX idx_pipeline_assigned ON public.pipeline_deals(assigned_to);

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.pipeline_deals
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

ALTER TABLE public.pipeline_deals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "pipeline_deals_select" ON public.pipeline_deals
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "pipeline_deals_insert" ON public.pipeline_deals
  FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "pipeline_deals_update" ON public.pipeline_deals
  FOR UPDATE TO authenticated USING (true);
CREATE POLICY "pipeline_deals_delete" ON public.pipeline_deals
  FOR DELETE TO authenticated USING (public.is_admin());
