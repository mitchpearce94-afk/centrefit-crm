-- Work status KPI (Mark, 14 Oct 2026 — "CRM work status report - changes I need").
-- 1. Hard gate: a job cannot move to Ready to Invoice / Complete with an empty
--    Work Completed log (replaces the Aug-2026 soft confirm).
-- 2. "No Charge" close-out status + reason, so free jobs leave the
--    awaiting-invoicing list instead of looking like lost money.
-- 3. Diary attendance: did_not_attend / rescheduled on a schedule entry so a
--    visit that never happened does not count against the technician.
-- 4. staff.is_external — subcontractor placeholders (e.g. "Electical
--    Contractor") are never scored; the KPI lands on the coordinator.
-- 5. work_status_report_items — "day N on this list" memory for the 4pm report.
-- 6. notification type job.work_status_report (per-staff email opt-out).

alter table public.staff
  add column if not exists is_external boolean not null default false;
comment on column public.staff.is_external is 'Subcontractor / placeholder record. Excluded from staff KPIs; work attributed to the coordinator who booked them.';

alter table public.schedule_entries
  add column if not exists attendance text
    check (attendance is null or attendance in ('did_not_attend','rescheduled'));
comment on column public.schedule_entries.attendance is 'NULL = attended as planned. did_not_attend / rescheduled visits never count as a missing write-up.';

alter table public.jobs
  add column if not exists no_charge_reason text;

insert into public.statuses (name, phase, sort_order, colour)
select 'No Charge', 'completion', 43, '#a3a3a3'
where not exists (select 1 from public.statuses where name = 'No Charge');
update public.statuses set sort_order = 44 where name = 'Cancelled' and sort_order = 43;

create table if not exists public.work_status_report_items (
  job_id uuid not null references public.jobs(id) on delete cascade,
  section text not null,
  first_seen date not null,
  last_seen date not null,
  cleared_on date,
  primary key (job_id, section)
);
alter table public.work_status_report_items enable row level security;
-- service-role only: no policies (cron + Cortex API read it with the service key).

insert into public.notification_types (code, label, category, description, default_enabled, email_enabled, push_enabled, priority, sort_order)
select 'job.work_status_report', 'Work status report (4pm)', 'Jobs',
       'Weekday 4pm: your jobs that are worked but not written up, not sent to invoice, or waiting to be invoiced. Admins get everyone''s.',
       true, true, push_enabled, priority, sort_order + 1
from public.notification_types where code = 'job.writeup_missing'
on conflict (code) do nothing;

-- Hard write-up gate.
create or replace function public.jobs_writeup_gate() returns trigger
language plpgsql as $$
declare
  new_name text;
  old_name text;
begin
  if new.status_id is not distinct from old.status_id then
    return new;
  end if;
  select name into new_name from public.statuses where id = new.status_id;
  if new_name is null or new_name not in ('Ready to Invoice', 'Complete') then
    return new;
  end if;
  select name into old_name from public.statuses where id = old.status_id;
  if old_name is not null and old_name in ('Ready to Invoice', 'Invoice Sent', 'Complete') then
    return new; -- already past the gate (e.g. Ready to Invoice -> Complete)
  end if;
  if not exists (
    select 1 from public.job_work_entries w
    where w.job_id = new.id and coalesce(btrim(w.content), '') <> ''
  ) then
    raise exception 'WRITEUP_REQUIRED: Work Completed is empty. Write the job up before moving it to %.', new_name
      using errcode = 'P0001', hint = 'Add a Work Completed entry (even one line), or use No Charge / Cancelled.';
  end if;
  return new;
end $$;

drop trigger if exists jobs_writeup_gate on public.jobs;
create trigger jobs_writeup_gate
  before update of status_id on public.jobs
  for each row execute function public.jobs_writeup_gate();
