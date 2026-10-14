-- New Build box additions (Sue, staff suggestions Oct 2026).
-- FB6EE0B8: "In the new build box can you put a 'Base Builder Handover Date'"
-- 8E5060AF: "can you add a TBC check box in the new build window"
--            (rough-in / fit-off / handover / opening dates are provisional).

alter table public.jobs add column if not exists handover_date date;
comment on column public.jobs.handover_date is 'Base builder handover date for a new build / fit-out (Sue, suggestion FB6EE0B8, Oct 2026). Shown in the job New Build box and on the public status board.';

alter table public.jobs add column if not exists dates_tbc boolean not null default false;
comment on column public.jobs.dates_tbc is 'New build dates are provisional / to be confirmed (Sue, suggestion 8E5060AF, Oct 2026). Shows a TBC pill on the status board; does not change scheduling.';
