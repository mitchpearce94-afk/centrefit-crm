-- billing.gap notification type for the weekly billing-gap watchdog cron
-- (GC collections without invoices / repeating-invoice cycles that produced no invoice).
-- Already applied to prod 2026-07-07 via MCP; kept here for parity.
INSERT INTO notification_types (code, label, category, description, default_enabled, priority, email_enabled, push_enabled, sort_order)
SELECT 'billing.gap', 'Billing gap detected', 'Billing',
       'Weekly watchdog: GC collections with no matching invoice, or repeating-invoice cycles that produced no invoice.',
       true, 'high', true,
       COALESCE((SELECT push_enabled FROM notification_types WHERE code = 'nbn.unbilled'), false),
       COALESCE((SELECT sort_order FROM notification_types WHERE code = 'nbn.unbilled'), 90) + 1
WHERE NOT EXISTS (SELECT 1 FROM notification_types WHERE code = 'billing.gap');
