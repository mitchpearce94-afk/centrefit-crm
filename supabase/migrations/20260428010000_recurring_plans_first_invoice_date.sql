-- Workstream A: customer-chosen start date for recurring plans.
-- See Cortex-Brain/06-PROJECTS/Centrefit-Website-Recurring-Funnel.md.

ALTER TABLE recurring_plans
  ADD COLUMN IF NOT EXISTS first_invoice_date date;

COMMENT ON COLUMN recurring_plans.first_invoice_date IS
  'Optional. Date the first auto-generated child invoice should fire. NULL = today (legacy behaviour). Used by activatePlan() in /api/gocardless/webhook when the mandate goes active. May be edited on a pending_mandate plan.';
