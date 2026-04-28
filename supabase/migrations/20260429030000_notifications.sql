-- Workstream F: notification system. Three tables + seed.
--
-- staff.id IS auth.users.id (FK chain) so RLS policies use `auth.uid()`
-- directly without an extra join through staff.user_id (which doesn't exist).

CREATE TABLE IF NOT EXISTS notification_types (
  code text PRIMARY KEY,
  label text NOT NULL,
  category text NOT NULL,
  description text,
  default_enabled boolean NOT NULL DEFAULT true,
  priority text NOT NULL DEFAULT 'high' CHECK (priority IN ('high', 'low')),
  email_enabled boolean NOT NULL DEFAULT true,
  push_enabled boolean NOT NULL DEFAULT true,
  sort_order int NOT NULL DEFAULT 100
);

CREATE TABLE IF NOT EXISTS staff_notification_preferences (
  staff_id uuid NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  type_code text NOT NULL REFERENCES notification_types(code) ON DELETE CASCADE,
  enabled boolean NOT NULL DEFAULT true,
  email_enabled boolean,
  push_enabled boolean,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (staff_id, type_code)
);

CREATE TABLE IF NOT EXISTS notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_id uuid NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  type_code text NOT NULL REFERENCES notification_types(code),
  ref_type text NOT NULL CHECK (ref_type IN ('quote', 'invoice', 'job', 'recurring_plan', 'enquiry')),
  ref_id uuid NOT NULL,
  title text NOT NULL,
  body text,
  href text,
  created_at timestamptz NOT NULL DEFAULT now(),
  read_at timestamptz,
  sent_via_email_at timestamptz,
  sent_via_push_at timestamptz,
  metadata jsonb
);

CREATE INDEX IF NOT EXISTS notifications_staff_unread_idx
  ON notifications (staff_id, read_at, created_at DESC) WHERE read_at IS NULL;
CREATE INDEX IF NOT EXISTS notifications_staff_recent_idx
  ON notifications (staff_id, created_at DESC);

ALTER TABLE notification_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE staff_notification_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY notification_types_read ON notification_types
  FOR SELECT TO authenticated USING (true);

CREATE POLICY snp_read_own ON staff_notification_preferences
  FOR SELECT TO authenticated USING (staff_id = auth.uid());
CREATE POLICY snp_write_own ON staff_notification_preferences
  FOR ALL TO authenticated
  USING (staff_id = auth.uid())
  WITH CHECK (staff_id = auth.uid());

CREATE POLICY notifications_read_own ON notifications
  FOR SELECT TO authenticated USING (staff_id = auth.uid());
CREATE POLICY notifications_update_own ON notifications
  FOR UPDATE TO authenticated USING (staff_id = auth.uid());

INSERT INTO notification_types (code, label, category, description, default_enabled, priority, sort_order) VALUES
  ('quote.sent', 'Quote sent', 'Quotes', 'Lets the assigned staffer know the quote went out.', false, 'low', 10),
  ('quote.accepted', 'Quote accepted', 'Quotes', 'Customer accepted a quote you sent.', true, 'high', 20),
  ('quote.declined', 'Quote declined', 'Quotes', 'Customer declined a quote you sent.', true, 'high', 30),
  ('invoice.created', 'Invoice created', 'Invoices', 'A new invoice was created.', false, 'low', 40),
  ('invoice.paid', 'Invoice paid', 'Invoices', 'Customer paid an invoice — funds reconciled in Xero.', true, 'high', 50),
  ('mandate.active', 'Mandate active', 'Recurring billing', 'Customer signed their direct-debit mandate.', true, 'high', 60),
  ('mandate.failed', 'Mandate failed', 'Recurring billing', 'A direct-debit mandate failed at the bank or was cancelled.', true, 'high', 70),
  ('recurring_plan.signup_link_sent', 'Mandate link sent', 'Recurring billing', 'Centrefit emailed the customer their direct-debit signup link.', false, 'low', 75),
  ('recurring_plan.signup_completed', 'Mandate signup completed', 'Recurring billing', 'Customer finished the GoCardless mandate signup form.', true, 'high', 76),
  ('job.assigned', 'Job assigned', 'Jobs', 'You were assigned to a job.', true, 'high', 80),
  ('job.scheduled', 'Job scheduled', 'Jobs', 'A job you''re on was scheduled in the calendar.', true, 'high', 90),
  ('job.ready_to_invoice', 'Job ready to invoice', 'Jobs', 'A job has reached the ready-to-invoice phase.', true, 'high', 100),
  ('job.complete', 'Job complete', 'Jobs', 'A job you owned was marked complete.', false, 'low', 110)
ON CONFLICT (code) DO UPDATE
  SET label = EXCLUDED.label,
      category = EXCLUDED.category,
      description = EXCLUDED.description,
      sort_order = EXCLUDED.sort_order;
