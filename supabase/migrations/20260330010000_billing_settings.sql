-- Billing settings table — configurable rates for quoting and invoicing
CREATE TABLE IF NOT EXISTS public.billing_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Labour rates
  labour_cost_rate NUMERIC(10,2) NOT NULL DEFAULT 75.00,
  labour_sell_rate NUMERIC(10,2) NOT NULL DEFAULT 150.00,
  -- Fixed costs
  callout_fee_cost NUMERIC(10,2) NOT NULL DEFAULT 80.00,
  callout_fee_sell NUMERIC(10,2) NOT NULL DEFAULT 80.00,
  callout_hours NUMERIC(5,2) NOT NULL DEFAULT 8.00,
  admin_rate_cost NUMERIC(10,2) NOT NULL DEFAULT 120.00,
  admin_rate_sell NUMERIC(10,2) NOT NULL DEFAULT 120.00,
  incidentals_cost NUMERIC(10,2) NOT NULL DEFAULT 200.00,
  incidentals_sell NUMERIC(10,2) NOT NULL DEFAULT 200.00,
  -- Markup & GST
  default_markup NUMERIC(5,2) NOT NULL DEFAULT 0.50,
  gst_rate NUMERIC(5,4) NOT NULL DEFAULT 0.10,
  -- Quote settings
  quote_validity_days INTEGER NOT NULL DEFAULT 30,
  uplift_percent NUMERIC(5,2) NOT NULL DEFAULT 5.00,
  -- Payment terms
  default_payment_terms TEXT NOT NULL DEFAULT 'Due on completion',
  progress_payment_enabled BOOLEAN NOT NULL DEFAULT true,
  -- Metadata
  updated_at TIMESTAMPTZ DEFAULT now(),
  updated_by UUID REFERENCES public.staff(id)
);

-- Singleton — only one row allowed
CREATE UNIQUE INDEX billing_settings_singleton ON public.billing_settings ((true));

-- Seed default row
INSERT INTO public.billing_settings DEFAULT VALUES;

-- RLS
ALTER TABLE public.billing_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "billing_settings_select" ON public.billing_settings FOR SELECT TO authenticated USING (true);
CREATE POLICY "billing_settings_update" ON public.billing_settings FOR UPDATE TO authenticated USING (true);

-- Quote expiry column
ALTER TABLE public.quotes ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;

-- Trigger to auto-update timestamp
CREATE OR REPLACE FUNCTION update_billing_settings_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER billing_settings_updated
  BEFORE UPDATE ON public.billing_settings
  FOR EACH ROW EXECUTE FUNCTION update_billing_settings_timestamp();
