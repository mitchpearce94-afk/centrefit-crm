-- Invoice reminder cadence reworked to four fixed milestones relative to the
-- due date (-3 / due day / +3 / +7), each tracked once via its own trigger
-- value. Extend the trigger CHECK to allow the new milestone kinds while
-- keeping the legacy values ('auto_due_soon','auto_overdue') for historical
-- rows. Requested by Mitchell 2026-06-30.
alter table invoice_reminders drop constraint if exists invoice_reminders_trigger_check;
alter table invoice_reminders add constraint invoice_reminders_trigger_check
  check (trigger = any (array[
    'manual'::text,
    'auto'::text,
    'auto_due_soon'::text,   -- legacy (pre 2026-06-30)
    'auto_overdue'::text,    -- legacy (pre 2026-06-30)
    'auto_due_3'::text,      -- 3 days before due
    'auto_due'::text,        -- on the due day
    'auto_overdue_3'::text,  -- 3 days after due
    'auto_overdue_7'::text   -- 7 days after due
  ]));
