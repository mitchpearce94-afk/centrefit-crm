-- Phase C (docs/documentation-CONTEXT.md): each staff member draws their
-- signature ONCE; the SWMS sign-on register auto-applies it from job_staff.
-- PNG data URL, self-served via /api/staff/signature (service-role route —
-- staff RLS is admin-only on UPDATE, client SDK self-edit silently no-ops).
alter table staff add column if not exists signature_data text;
alter table staff add column if not exists signature_updated_at timestamptz;
