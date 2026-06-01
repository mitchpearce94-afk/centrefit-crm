-- Lock pricing/config tables to admin-only WRITES (audit 2026-06-01).
--
-- billing_settings, labour_timings, quote_products and recurring_services drive
-- every quote's pricing/margin/GST and the recurring catalogue. Their write
-- policies were `true`, so ANY authenticated staffer (incl. field_staff) could
-- silently rewrite labour sell rates, GST, product prices, etc. via the client
-- SDK. We restrict INSERT/UPDATE/DELETE to public.is_admin() while leaving
-- SELECT open, because the quote engine + quoting UI legitimately READ these
-- for non-admin staff.

-- billing_settings (singleton; only UPDATE exists)
drop policy if exists billing_settings_update on public.billing_settings;
create policy billing_settings_update on public.billing_settings
  for update using (public.is_admin()) with check (public.is_admin());

-- labour_timings: split the permissive ALL(true) policy into open-read +
-- admin-write. On SELECT the two permissive policies OR together (true), so
-- non-admins keep read access; writes match only the admin policy.
drop policy if exists "Authenticated users can manage labour timings" on public.labour_timings;
create policy labour_timings_select on public.labour_timings
  for select using (true);
create policy labour_timings_admin_modify on public.labour_timings
  for all using (public.is_admin()) with check (public.is_admin());

-- quote_products: DELETE already is_admin(); lock INSERT + UPDATE too.
drop policy if exists quote_products_insert on public.quote_products;
create policy quote_products_insert on public.quote_products
  for insert with check (public.is_admin());
drop policy if exists quote_products_update on public.quote_products;
create policy quote_products_update on public.quote_products
  for update using (public.is_admin()) with check (public.is_admin());

-- recurring_services: DELETE already is_admin(); lock INSERT + UPDATE too.
drop policy if exists recurring_services_insert on public.recurring_services;
create policy recurring_services_insert on public.recurring_services
  for insert with check (public.is_admin());
drop policy if exists recurring_services_update on public.recurring_services;
create policy recurring_services_update on public.recurring_services
  for update using (public.is_admin()) with check (public.is_admin());
