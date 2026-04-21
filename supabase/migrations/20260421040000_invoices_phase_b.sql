-- =============================================================================
-- Finance Phase B — Invoices table + Xero contact mapping
-- =============================================================================

-- 1. customers.xero_contact_id — set once a customer has been pushed to Xero.
ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS xero_contact_id TEXT;

CREATE INDEX IF NOT EXISTS idx_customers_xero_contact
  ON public.customers(xero_contact_id)
  WHERE xero_contact_id IS NOT NULL;

-- 2. INVOICES — mirrors a Xero invoice plus CRM context (quote/job/customer).
--    invoice_type:
--      full           — single invoice for a non-progress quote
--      progress_pp1   — first payment of a progress quote (on acceptance)
--      progress_pp2   — second payment of a progress quote (on completion)
--      adhoc          — invoice not linked to a quote (technician write-up)
--    status tracks the Xero lifecycle at our level of interest:
--      draft → authorised → paid | void
CREATE TABLE IF NOT EXISTS public.invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_type TEXT NOT NULL CHECK (invoice_type IN ('full','progress_pp1','progress_pp2','adhoc')),
  quote_id UUID REFERENCES public.quotes(id) ON DELETE SET NULL,
  job_id UUID REFERENCES public.jobs(id) ON DELETE SET NULL,
  customer_id UUID REFERENCES public.customers(id) ON DELETE SET NULL,
  description TEXT,                               -- Header-level summary (copied onto Xero reference)
  line_items JSONB NOT NULL DEFAULT '[]'::jsonb,  -- [{ description, quantity, unit_amount, account_code, tax_type }]
  subtotal NUMERIC(12,2) NOT NULL DEFAULT 0,      -- ex GST
  gst NUMERIC(12,2) NOT NULL DEFAULT 0,
  total NUMERIC(12,2) NOT NULL DEFAULT 0,         -- inc GST
  amount_paid NUMERIC(12,2) NOT NULL DEFAULT 0,
  amount_due NUMERIC(12,2) NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'AUD',
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','authorised','paid','void')),
  xero_invoice_id TEXT UNIQUE,                    -- Xero-side InvoiceID (UUID string)
  xero_invoice_number TEXT,                       -- Xero-generated InvoiceNumber (e.g. INV-001234)
  xero_online_url TEXT,                           -- Public pay-now URL for the customer
  xero_last_synced_at TIMESTAMPTZ,
  xero_last_error TEXT,
  issued_at TIMESTAMPTZ,
  due_date DATE,
  paid_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by UUID REFERENCES public.staff(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_invoices_customer ON public.invoices(customer_id);
CREATE INDEX IF NOT EXISTS idx_invoices_quote    ON public.invoices(quote_id);
CREATE INDEX IF NOT EXISTS idx_invoices_job      ON public.invoices(job_id);
CREATE INDEX IF NOT EXISTS idx_invoices_status   ON public.invoices(status);

-- updated_at trigger (mirrors existing pattern used elsewhere)
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS invoices_set_updated_at ON public.invoices;
CREATE TRIGGER invoices_set_updated_at
  BEFORE UPDATE ON public.invoices
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- RLS — mirror the `quotes` policy pattern: all authenticated staff read/write,
-- only admins can delete. No anon access.
ALTER TABLE public.invoices ENABLE ROW LEVEL SECURITY;

CREATE POLICY "invoices_select" ON public.invoices
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "invoices_insert" ON public.invoices
  FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "invoices_update" ON public.invoices
  FOR UPDATE TO authenticated USING (true);
CREATE POLICY "invoices_delete" ON public.invoices
  FOR DELETE TO authenticated USING (public.is_admin());

COMMENT ON TABLE public.invoices IS
  'CRM-side invoice records mirrored from Xero. Created via POST /api/invoices/create. Kept in sync via /api/invoices/[id]/refresh.';
