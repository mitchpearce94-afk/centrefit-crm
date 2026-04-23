-- Enforce uniqueness on quote refs so we can't silently collide again.
--
-- Bug observed 2026-04-23: two quotes ended up with ref CF-2026-0006 because
-- the wizard used `SELECT count(*)+1` across all quotes (not year-scoped, not
-- atomic, no DB-level guard). First row 0b372566... (2026-04-22, accepted);
-- second row 78e44193... (2026-04-23, draft) was manually renamed to 0007
-- before applying this constraint.
--
-- This index guarantees any future ref collision fails at insert time rather
-- than silently duplicating. The wizard retries on collision.

create unique index if not exists quotes_ref_unique_idx
  on public.quotes (ref);
