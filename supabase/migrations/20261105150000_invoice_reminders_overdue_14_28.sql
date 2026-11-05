-- Two more automatic reminder milestones, 14 and 28 days overdue
-- (Mitchell 2026-11-05: invoices went quiet after the +7 nudge). Applied via MCP.
alter table invoice_reminders drop constraint if exists invoice_reminders_trigger_check;
alter table invoice_reminders add constraint invoice_reminders_trigger_check
  check (trigger = any (array['manual','auto','auto_due_soon','auto_overdue','auto_due_3','auto_due','auto_overdue_3','auto_overdue_7','auto_overdue_14','auto_overdue_28']));
