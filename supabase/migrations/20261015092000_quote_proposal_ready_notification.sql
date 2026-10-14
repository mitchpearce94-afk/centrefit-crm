-- Staff suggestion 6B9C6180 (Lily Duncalfe, PM, 2026-07-21): notify project
-- managers when a Snap Fitness proposal is ready to be completed so it is not
-- forgotten in the quote process.
--
-- Trigger lives in the app: POST /api/quotes/{id}/proposal-ready, fired by the
-- quote wizard the moment a NEW draft quote on the snap_fitness rule template
-- is inserted. One notification per quote (deduped on notifications rows).
-- Bell + email on by default; per-staff opt-out via staff_notification_preferences.

insert into public.notification_types (code, label, category, description, default_enabled, email_enabled, push_enabled, priority, sort_order)
select 'quote.proposal_ready', 'Snap proposal ready to complete', 'Quotes',
       'A draft Snap Fitness quote has been created from a plan and needs finishing and sending as a proposal',
       true, true, true, 'high',
       coalesce((select max(sort_order) from public.notification_types where category = 'Quotes'), 100) + 1
on conflict (code) do nothing;
