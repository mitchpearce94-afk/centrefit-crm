-- Phase D handover acceptance notifications.
insert into notification_types (code, label, category, description, default_enabled, priority, email_enabled, sort_order)
values
  ('handover.viewed', 'Handover pack opened', 'Documents', 'Customer opened a handover acceptance link', true, 'low', false, 93),
  ('handover.accepted', 'Handover accepted', 'Documents', 'Customer signed and accepted the handover documentation', true, 'high', true, 92)
on conflict (code) do nothing;
