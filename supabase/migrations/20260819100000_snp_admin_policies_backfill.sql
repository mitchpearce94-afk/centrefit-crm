-- =============================================================================
-- Backfill: admin policies on staff_notification_preferences.
--
-- snp_read_admin_all / snp_write_admin_all already exist in production (applied
-- via MCP in a past session but never committed). Without them the staff-page
-- notification editor can neither show nor save other staff members' prefs —
-- snp_read_own / snp_write_own are scoped to auth.uid(). This file records the
-- live policies so a rebuild from migrations reproduces them. Idempotent.
-- =============================================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'staff_notification_preferences' AND policyname = 'snp_read_admin_all'
  ) THEN
    CREATE POLICY snp_read_admin_all ON public.staff_notification_preferences
      FOR SELECT TO authenticated
      USING (EXISTS (
        SELECT 1 FROM public.staff
        WHERE staff.id = auth.uid() AND staff.role = 'admin' AND staff.is_active = true
      ));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'staff_notification_preferences' AND policyname = 'snp_write_admin_all'
  ) THEN
    CREATE POLICY snp_write_admin_all ON public.staff_notification_preferences
      FOR ALL TO authenticated
      USING (EXISTS (
        SELECT 1 FROM public.staff
        WHERE staff.id = auth.uid() AND staff.role = 'admin' AND staff.is_active = true
      ))
      WITH CHECK (EXISTS (
        SELECT 1 FROM public.staff
        WHERE staff.id = auth.uid() AND staff.role = 'admin' AND staff.is_active = true
      ));
  END IF;
END $$;
