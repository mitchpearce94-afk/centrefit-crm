-- The partial unique index can't be targeted by PostgREST upsert's ON CONFLICT
-- (no WHERE clause in the inference spec). A full unique index behaves the
-- same: manual tasks carry a NULL source_ref and NULLs never collide.

drop index if exists public.personal_tasks_auto_ref_uq;

create unique index if not exists personal_tasks_auto_ref_uq
  on public.personal_tasks (owner_id, source, source_ref);
