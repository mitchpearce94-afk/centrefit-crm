-- Security-definer review (2026-07-06): all 20 definer functions have
-- pinned search_paths and internal guards where needed
-- (log_permission_change checks is_admin(); vault fns gate on auth keys).
-- One tighten: handle_new_user is a trigger function — nothing should be
-- able to invoke it directly.
revoke execute on function public.handle_new_user() from authenticated, anon, public;
