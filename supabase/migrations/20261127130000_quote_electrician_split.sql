-- Electrician cost split into rough-in and fit-off (Mitchell, 27 Nov 2026) so
-- Sue / Mark can check the sparky's invoices against the quote at a glance.
-- quotes.electrician_cost stays the TOTAL (lint, job progress and pricing read
-- it); anything in the total not covered by these two is "other" electrical
-- (power to the rack etc.).
-- Applied via the Supabase MCP on 27 Nov 2026.
alter table public.quotes add column if not exists electrician_rough_in_cost numeric default 0;
alter table public.quotes add column if not exists electrician_fit_off_cost numeric default 0;
comment on column public.quotes.electrician_rough_in_cost is 'Electrician''s quoted cost for the rough-in (ex GST). Part of electrician_cost. 27 Nov 2026.';
comment on column public.quotes.electrician_fit_off_cost is 'Electrician''s quoted cost for the fit-off (ex GST). Part of electrician_cost. 27 Nov 2026.';
