-- Workstream E: document activity log for quotes and invoices.

CREATE TABLE IF NOT EXISTS document_activity (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_type text NOT NULL CHECK (document_type IN ('quote', 'invoice', 'recurring_plan')),
  document_id uuid NOT NULL,
  event_type text NOT NULL,
  event_at timestamptz NOT NULL DEFAULT now(),
  actor text NOT NULL DEFAULT 'system',
  metadata jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS document_activity_lookup_idx
  ON document_activity (document_type, document_id, event_at DESC);

CREATE INDEX IF NOT EXISTS document_activity_event_type_idx
  ON document_activity (event_type, event_at DESC);

COMMENT ON TABLE document_activity IS
  'Append-only timeline of events on quotes/invoices/recurring plans. Drives the activity panel on document detail pages and feeds the notification system (workstream F).';
COMMENT ON COLUMN document_activity.event_type IS
  'Examples: quote.sent, quote.viewed, quote.accepted, quote.declined, invoice.created, invoice.authorised, invoice.email_delivered, invoice.email_opened, invoice.paid, invoice.voided';

ALTER TABLE document_activity ENABLE ROW LEVEL SECURITY;

CREATE POLICY document_activity_read ON document_activity
  FOR SELECT TO authenticated USING (true);

CREATE POLICY document_activity_insert_authenticated ON document_activity
  FOR INSERT TO authenticated WITH CHECK (true);
