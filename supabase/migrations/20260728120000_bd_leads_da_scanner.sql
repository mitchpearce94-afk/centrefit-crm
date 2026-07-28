-- BD lead scanner (QLD growth phase 1 — docs/qld-growth-CONTEXT.md D5).
-- Nightly cron scans SEQ council development-application feeds for phase-1
-- verticals (childcare, medical, gym, commercial fitout) and lands matches
-- here. INSERTs are cron/service-role only; staff can read + work the lead
-- (status/notes). Applied to remote 2026-07-28 via MCP; file for the record.
CREATE TABLE IF NOT EXISTS public.bd_leads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source TEXT NOT NULL,                 -- council slug ('brisbane','logan'…) or manual channel
  application_number TEXT NOT NULL,     -- council DA/application reference
  address TEXT,
  description TEXT,
  use_type TEXT,
  applicant TEXT,
  application_type TEXT,
  lodged_date DATE,
  decision_status TEXT,
  url TEXT,                             -- deep link to the council portal
  matched_keywords TEXT[] NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new','reviewing','contacted','quoted','won','dead','ignored')),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS bd_leads_source_appno ON public.bd_leads (source, application_number);
CREATE INDEX IF NOT EXISTS bd_leads_status_idx ON public.bd_leads (status, created_at DESC);
ALTER TABLE public.bd_leads ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS bd_leads_select ON public.bd_leads;
CREATE POLICY bd_leads_select ON public.bd_leads FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS bd_leads_update ON public.bd_leads;
CREATE POLICY bd_leads_update ON public.bd_leads FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

INSERT INTO public.notification_types (code, label, category, description, default_enabled, priority, email_enabled, push_enabled, sort_order)
VALUES ('bd.lead', 'New construction lead (DA scanner)', 'BD', 'Nightly SEQ council development-application scanner found new phase-1 leads', true, 'high', false, false, 220)
ON CONFLICT (code) DO NOTHING;
