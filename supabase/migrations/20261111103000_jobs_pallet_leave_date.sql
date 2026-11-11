-- New Build box: "Pallet to leave" date (Mitchell, 11 Nov 2026).
-- The date the equipment pallet has to leave the warehouse for the site —
-- sits alongside rough-in / fit-off / handover / opening. Single date, no crew booking.

alter table public.jobs add column if not exists pallet_leave_date date;
comment on column public.jobs.pallet_leave_date is 'Date the pallet must leave the warehouse for site (Mitchell, Nov 2026). Shown in the job New Build box and on the public status board. No scheduler booking.';
