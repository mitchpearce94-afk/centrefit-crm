-- Unfilled write-up watchdog (Mitchell 2026-08-18): notification type for
-- "you worked a job today but Work Completed is still empty".
-- (Applied to prod via Supabase MCP the same day — db push is blocked by
-- migration-history drift; file kept for the record.)
insert into notification_types (code, label, category, description, default_enabled, priority, email_enabled, push_enabled, sort_order)
select 'job.writeup_missing', 'Job write-up missing', 'Jobs',
       'You worked a job today but nothing has been written in Work Completed.',
       true, 'high', true, true, 75
where not exists (select 1 from notification_types where code = 'job.writeup_missing');
