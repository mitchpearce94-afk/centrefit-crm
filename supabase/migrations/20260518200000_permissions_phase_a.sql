-- =============================================================================
-- Permissions Phase A (2026-05-18)
-- =============================================================================
-- Implements the data model + helper functions for the role-based permission
-- system described in docs/permissions-CONTEXT.md. Phase A only — no UI,
-- no migration of existing role checks. Those follow in Phase B/C.
--
-- Tables:
--   permission_flags          — catalogue (seeded; new flags ship via migration)
--   role_default_permissions  — per-role default flag set (seeded)
--   staff_permissions         — per-staff overrides (runtime-mutable)
--   permission_audit_log      — append-only audit trail
--
-- Helpers:
--   public.has_permission(p_flag)             — bool, for current user
--   public.has_permission_for(p_staff, p_flag) — bool, for arbitrary staff (admin-only callers)
--   public.log_permission_change(...)         — security-definer audit writer
--
-- Conventions match staff_notification_preferences (D3) and is_admin()
-- (existing helper). Idempotent — CREATE IF NOT EXISTS + ON CONFLICT seeds.
-- =============================================================================

-- 1. permission_flags --------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.permission_flags (
  flag         TEXT PRIMARY KEY,
  area         TEXT NOT NULL,
  label        TEXT NOT NULL,
  description  TEXT,
  sort_order   INT NOT NULL DEFAULT 100
);

ALTER TABLE public.permission_flags ENABLE ROW LEVEL SECURITY;

-- Catalogue is readable to every authenticated user (the admin UI lists
-- flags; the route guards may need to discover them too).
DROP POLICY IF EXISTS permission_flags_read ON public.permission_flags;
CREATE POLICY permission_flags_read ON public.permission_flags
  FOR SELECT TO authenticated USING (true);

-- Writes only happen via migrations (no UI), but guard the table anyway.
DROP POLICY IF EXISTS permission_flags_admin_write ON public.permission_flags;
CREATE POLICY permission_flags_admin_write ON public.permission_flags
  FOR ALL TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());

-- 2. role_default_permissions ------------------------------------------------

CREATE TABLE IF NOT EXISTS public.role_default_permissions (
  role  TEXT NOT NULL,
  flag  TEXT NOT NULL REFERENCES public.permission_flags(flag) ON DELETE CASCADE,
  PRIMARY KEY (role, flag),
  CHECK (role IN ('admin', 'finance_manager', 'project_manager', 'field_staff'))
);

ALTER TABLE public.role_default_permissions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS rdp_read ON public.role_default_permissions;
CREATE POLICY rdp_read ON public.role_default_permissions
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS rdp_admin_write ON public.role_default_permissions;
CREATE POLICY rdp_admin_write ON public.role_default_permissions
  FOR ALL TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());

-- 3. staff_permissions -------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.staff_permissions (
  staff_id    UUID NOT NULL REFERENCES public.staff(id) ON DELETE CASCADE,
  flag        TEXT NOT NULL REFERENCES public.permission_flags(flag) ON DELETE CASCADE,
  granted     BOOLEAN NOT NULL,
  granted_by  UUID REFERENCES public.staff(id) ON DELETE SET NULL,
  granted_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (staff_id, flag)
);

CREATE INDEX IF NOT EXISTS idx_staff_permissions_staff ON public.staff_permissions(staff_id);

ALTER TABLE public.staff_permissions ENABLE ROW LEVEL SECURITY;

-- A staff can see their own overrides (for the dashboard to know what to show);
-- admins can see everyone's.
DROP POLICY IF EXISTS staff_permissions_read ON public.staff_permissions;
CREATE POLICY staff_permissions_read ON public.staff_permissions
  FOR SELECT TO authenticated
  USING (staff_id = auth.uid() OR public.is_admin());

-- Only admins can grant/revoke.
DROP POLICY IF EXISTS staff_permissions_admin_write ON public.staff_permissions;
CREATE POLICY staff_permissions_admin_write ON public.staff_permissions
  FOR ALL TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());

-- 4. permission_audit_log ----------------------------------------------------

CREATE TABLE IF NOT EXISTS public.permission_audit_log (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  changed_staff_id  UUID NOT NULL REFERENCES public.staff(id) ON DELETE CASCADE,
  changed_by        UUID REFERENCES public.staff(id) ON DELETE SET NULL,
  flag              TEXT,                            -- null when role itself changed
  action            TEXT NOT NULL CHECK (action IN ('grant', 'revoke', 'reset', 'role_change')),
  before            TEXT,
  after             TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_perm_audit_staff ON public.permission_audit_log(changed_staff_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_perm_audit_created ON public.permission_audit_log(created_at DESC);

ALTER TABLE public.permission_audit_log ENABLE ROW LEVEL SECURITY;

-- Admins only — audit log mirrors vault audit pattern (D11).
DROP POLICY IF EXISTS perm_audit_admin_read ON public.permission_audit_log;
CREATE POLICY perm_audit_admin_read ON public.permission_audit_log
  FOR SELECT TO authenticated USING (public.is_admin());

-- No direct inserts/updates/deletes from clients. Writes go through
-- log_permission_change() (security definer) so the changed_by column
-- always reflects the authenticated user, not a forged value.
DROP POLICY IF EXISTS perm_audit_no_direct_write ON public.permission_audit_log;
CREATE POLICY perm_audit_no_direct_write ON public.permission_audit_log
  FOR ALL TO authenticated USING (false) WITH CHECK (false);

-- 5. has_permission helpers --------------------------------------------------

-- Effective permission for the CURRENT user.
--   - admin role short-circuits to true.
--   - explicit override (staff_permissions) wins over role default.
--   - else: role default presence in role_default_permissions.
CREATE OR REPLACE FUNCTION public.has_permission(p_flag TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
AS $$
DECLARE
  v_staff_id  UUID := auth.uid();
  v_role      TEXT;
  v_override  BOOLEAN;
  v_role_has  BOOLEAN;
BEGIN
  IF v_staff_id IS NULL THEN RETURN false; END IF;

  SELECT role INTO v_role FROM public.staff WHERE id = v_staff_id AND is_active;
  IF v_role IS NULL THEN RETURN false; END IF;
  IF v_role = 'admin' THEN RETURN true; END IF;

  SELECT granted INTO v_override
  FROM public.staff_permissions
  WHERE staff_id = v_staff_id AND flag = p_flag;
  IF v_override IS NOT NULL THEN RETURN v_override; END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.role_default_permissions
    WHERE role = v_role AND flag = p_flag
  ) INTO v_role_has;
  RETURN v_role_has;
END;
$$;

-- Effective permission for an arbitrary staff_id. Used by admins inspecting
-- another staff's resolved permissions (and by future test harnesses).
CREATE OR REPLACE FUNCTION public.has_permission_for(p_staff_id UUID, p_flag TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
AS $$
DECLARE
  v_role      TEXT;
  v_override  BOOLEAN;
  v_role_has  BOOLEAN;
BEGIN
  IF p_staff_id IS NULL THEN RETURN false; END IF;

  SELECT role INTO v_role FROM public.staff WHERE id = p_staff_id AND is_active;
  IF v_role IS NULL THEN RETURN false; END IF;
  IF v_role = 'admin' THEN RETURN true; END IF;

  SELECT granted INTO v_override
  FROM public.staff_permissions
  WHERE staff_id = p_staff_id AND flag = p_flag;
  IF v_override IS NOT NULL THEN RETURN v_override; END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.role_default_permissions
    WHERE role = v_role AND flag = p_flag
  ) INTO v_role_has;
  RETURN v_role_has;
END;
$$;

-- Audit writer. Called from the API route that grants/revokes. Forces
-- changed_by = auth.uid() so the row can't be forged. Will refuse to write
-- when the caller is not an admin.
CREATE OR REPLACE FUNCTION public.log_permission_change(
  p_changed_staff_id UUID,
  p_flag             TEXT,
  p_action           TEXT,
  p_before           TEXT,
  p_after            TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_id UUID;
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'permission_audit_log: caller is not admin';
  END IF;
  INSERT INTO public.permission_audit_log
    (changed_staff_id, changed_by, flag, action, before, after)
  VALUES
    (p_changed_staff_id, auth.uid(), p_flag, p_action, p_before, p_after)
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

-- 6. Seed permission_flags ---------------------------------------------------
-- Catalogue v1 per docs/permissions-CONTEXT.md D4. Ordered for stable UI
-- grouping: area sort_order is the row's sort_order / 100; within an area the
-- last two digits order the flags.

INSERT INTO public.permission_flags (flag, area, label, description, sort_order) VALUES
  -- Customers
  ('customers.view',                'Customers',  'View customers',           'Can see the customer list and detail pages.', 110),
  ('customers.edit_basic',          'Customers',  'Edit basic info',          'Name, address, contacts, notes.', 111),
  ('customers.create',              'Customers',  'Create customers',         'Add brand-new customer records.', 112),
  ('customers.archive',             'Customers',  'Archive customers',        'Soft-delete (admin recovery only).', 113),
  ('customers.edit_billing_terms',  'Customers',  'Edit billing terms',       'Default payment terms, Xero contact link.', 114),
  -- Sites
  ('sites.view',                    'Sites',      'View sites',               'See site list, detail, key info.', 210),
  ('sites.edit_basic',              'Sites',      'Edit basic info',          'Site name, address, primary contact.', 211),
  ('sites.manage_assets',           'Sites',      'Manage on-site assets',    'Add/edit/remove site assets — including network credentials.', 212),
  ('sites.manage_contacts',         'Sites',      'Manage site contacts',     'Add/edit/remove contacts at this site.', 213),
  ('sites.edit_key_info',           'Sites',      'Edit key info',            'Key info tab content + photos (alarm panel, rack, etc).', 214),
  -- Jobs
  ('jobs.view',                     'Jobs',       'View jobs',                'See jobs (scope further narrowed by view_all).', 310),
  ('jobs.view_all',                 'Jobs',       'View ALL jobs',            'Without this flag, only sees jobs they''re assigned to.', 311),
  ('jobs.update_status',            'Jobs',       'Update job status',        'Move a job through status transitions, add work entries.', 312),
  ('jobs.manage',                   'Jobs',       'Manage jobs',              'Create, edit details, cancel.', 313),
  ('jobs.assign_others',            'Jobs',       'Assign teammates',         'Add/remove other staff on a job.', 314),
  -- Quoting
  ('quoting.view',                  'Quoting',    'View quotes',              'See the Quoting tab and quote detail pages.', 410),
  ('quoting.view_amounts',          'Quoting',    'View $ amounts',           'Without this, dollar columns show as —.', 411),
  ('quoting.view_cost_prices',      'Quoting',    'View cost prices',         'Internal supplier cost — finance-only by default.', 412),
  ('quoting.create',                'Quoting',    'Create quotes',            'New quote, edit scope, add lines.', 413),
  ('quoting.send',                  'Quoting',    'Send quotes',              'Email the quote PDF to the customer.', 414),
  ('quoting.accept_manually',       'Quoting',    'Accept on customer''s behalf', 'Mark a quote accepted without the customer clicking accept.', 415),
  -- Invoices
  ('invoices.view',                 'Invoices',   'View invoices',            'See the Invoices tab and detail pages.', 510),
  ('invoices.view_amounts',         'Invoices',   'View $ amounts',           'Without this, dollar columns show as —.', 511),
  ('invoices.authorise',            'Invoices',   'Authorise (Xero DRAFT → AUTHORISED)', 'Tighter than send — binding commercial commitment. Admin + finance only by default.', 512),
  ('invoices.send',                 'Invoices',   'Send invoices',            'Email invoice to customer.', 513),
  ('invoices.manage_recurring',     'Invoices',   'Manage recurring plans',   'Set up/edit/cancel recurring billing plans.', 514),
  -- Scheduler
  ('scheduler.view_all_team',       'Scheduler',  'View whole team''s schedule', 'Without this, only own entries are visible.', 610),
  ('scheduler.manage',              'Scheduler',  'Manage schedule entries',  'Create/edit/move entries.', 611),
  ('scheduler.assign_others',       'Scheduler',  'Schedule other staff',     'Book other staff onto entries, not just yourself.', 612),
  -- Procurement
  ('procurement.view',              'Procurement','View procurement',         'See POs and outstanding stock orders.', 710),
  ('procurement.view_costs',        'Procurement','View costs',               'Supplier cost per line — finance-only by default.', 711),
  ('procurement.manage',            'Procurement','Create / send POs',        'Create draft POs and email them.', 712),
  ('procurement.receive',           'Procurement','Receive stock',            'Mark PO lines as received when stock arrives.', 713),
  -- Plans
  ('plans.view',                    'Plans',      'View plans',               'See the plan builder and saved plans.', 810),
  ('plans.manage',                  'Plans',      'Manage plans',             'Create/edit/delete plans.', 811),
  ('plans.send_to_electrician',     'Plans',      'Send plans to electrician','Email plan PDF to assigned electrician.', 812),
  -- NBN
  ('nbn.view',                      'NBN',        'View NBN tab',             'See enquiries and qualification results.', 910),
  ('nbn.manage',                    'NBN',        'Manage NBN enquiries',     'Run qualifications, update enquiry status.', 911),
  ('nbn.view_recurring_revenue',    'NBN',        'View NBN recurring revenue','MRR / cash-flow lens — finance.', 912),
  -- Suppliers
  ('suppliers.view',                'Suppliers',  'View suppliers',           'See the supplier list and detail.', 1010),
  ('suppliers.view_pricing',        'Suppliers',  'View supplier pricing',    'Cost prices on parts catalogue.', 1011),
  ('suppliers.manage',              'Suppliers',  'Manage suppliers',         'Add/edit/disable suppliers and parts.', 1012),
  -- Reports
  ('reports.view_operational',      'Reports',    'View operational reports', 'Job throughput, schedule utilisation, etc.', 1110),
  ('reports.view_financial',        'Reports',    'View financial reports',   'Revenue, cash collected, AR.', 1111),
  -- Settings
  ('settings.basic',                'Settings',   'Edit own settings',        'Profile, notification prefs.', 1210),
  ('settings.staff',                'Settings',   'Manage staff & permissions','Admin only — hard-locked.', 1211),
  ('settings.integrations',         'Settings',   'Manage integrations',      'Xero, GoCardless, Stripe, Resend, Kinetix.', 1212),
  ('settings.business_units',       'Settings',   'Manage business units',    'Categories and job types.', 1213),
  ('settings.products',             'Settings',   'Manage product catalogue', 'Products, BOMs, pricing rules.', 1214),
  ('settings.electricians',         'Settings',   'Manage electricians',      'Electrician list for plan handoff.', 1215),
  ('settings.asset_types',          'Settings',   'Manage asset types',       'Asset catalogue used on site detail pages.', 1216),
  -- Vault
  ('vault.access',                  'Vault',      'Has vault access',         'Does this staff have a vault account at all. Folder-level membership is orthogonal.', 1310)
ON CONFLICT (flag) DO UPDATE
  SET area = EXCLUDED.area,
      label = EXCLUDED.label,
      description = EXCLUDED.description,
      sort_order = EXCLUDED.sort_order;

-- 7. Seed role_default_permissions -------------------------------------------
-- Per docs/permissions-CONTEXT.md D8. Admin still seeded with every flag for
-- UI honesty (the editor shows the full set as "default on") — has_permission
-- short-circuits admin to true regardless.

-- Wipe & re-seed: defaults change via migration, not at runtime, so a full
-- replace is safe and keeps the seed declarative.
DELETE FROM public.role_default_permissions;

-- admin → every flag
INSERT INTO public.role_default_permissions (role, flag)
SELECT 'admin', flag FROM public.permission_flags;

-- finance_manager
INSERT INTO public.role_default_permissions (role, flag) VALUES
  ('finance_manager', 'customers.view'),
  ('finance_manager', 'customers.edit_basic'),
  ('finance_manager', 'customers.edit_billing_terms'),
  ('finance_manager', 'sites.view'),
  ('finance_manager', 'jobs.view'),
  ('finance_manager', 'jobs.view_all'),
  ('finance_manager', 'quoting.view'),
  ('finance_manager', 'quoting.view_amounts'),
  ('finance_manager', 'quoting.view_cost_prices'),
  ('finance_manager', 'invoices.view'),
  ('finance_manager', 'invoices.view_amounts'),
  ('finance_manager', 'invoices.authorise'),
  ('finance_manager', 'invoices.send'),
  ('finance_manager', 'invoices.manage_recurring'),
  ('finance_manager', 'scheduler.view_all_team'),
  ('finance_manager', 'procurement.view'),
  ('finance_manager', 'procurement.view_costs'),
  ('finance_manager', 'plans.view'),
  ('finance_manager', 'nbn.view'),
  ('finance_manager', 'nbn.view_recurring_revenue'),
  ('finance_manager', 'suppliers.view'),
  ('finance_manager', 'suppliers.view_pricing'),
  ('finance_manager', 'reports.view_operational'),
  ('finance_manager', 'reports.view_financial'),
  ('finance_manager', 'settings.basic'),
  ('finance_manager', 'vault.access');

-- project_manager
INSERT INTO public.role_default_permissions (role, flag) VALUES
  ('project_manager', 'customers.view'),
  ('project_manager', 'customers.edit_basic'),
  ('project_manager', 'customers.create'),
  ('project_manager', 'sites.view'),
  ('project_manager', 'sites.edit_basic'),
  ('project_manager', 'sites.manage_assets'),
  ('project_manager', 'sites.manage_contacts'),
  ('project_manager', 'sites.edit_key_info'),
  ('project_manager', 'jobs.view'),
  ('project_manager', 'jobs.view_all'),
  ('project_manager', 'jobs.update_status'),
  ('project_manager', 'jobs.manage'),
  ('project_manager', 'jobs.assign_others'),
  ('project_manager', 'quoting.view'),
  ('project_manager', 'quoting.view_amounts'),
  ('project_manager', 'quoting.create'),
  ('project_manager', 'quoting.send'),
  ('project_manager', 'quoting.accept_manually'),
  ('project_manager', 'invoices.view'),
  ('project_manager', 'invoices.view_amounts'),
  ('project_manager', 'invoices.send'),
  ('project_manager', 'scheduler.view_all_team'),
  ('project_manager', 'scheduler.manage'),
  ('project_manager', 'scheduler.assign_others'),
  ('project_manager', 'procurement.view'),
  ('project_manager', 'procurement.manage'),
  ('project_manager', 'procurement.receive'),
  ('project_manager', 'plans.view'),
  ('project_manager', 'plans.manage'),
  ('project_manager', 'plans.send_to_electrician'),
  ('project_manager', 'nbn.view'),
  ('project_manager', 'nbn.manage'),
  ('project_manager', 'suppliers.view'),
  ('project_manager', 'reports.view_operational'),
  ('project_manager', 'settings.basic'),
  ('project_manager', 'settings.electricians'),
  ('project_manager', 'vault.access');

-- field_staff
INSERT INTO public.role_default_permissions (role, flag) VALUES
  ('field_staff', 'customers.view'),
  ('field_staff', 'customers.edit_basic'),
  ('field_staff', 'sites.view'),
  ('field_staff', 'sites.edit_basic'),
  ('field_staff', 'sites.manage_assets'),
  ('field_staff', 'sites.manage_contacts'),
  ('field_staff', 'sites.edit_key_info'),
  ('field_staff', 'jobs.view'),
  ('field_staff', 'jobs.update_status'),
  ('field_staff', 'procurement.receive'),
  ('field_staff', 'plans.view'),
  ('field_staff', 'nbn.view'),
  ('field_staff', 'suppliers.view'),
  ('field_staff', 'settings.basic'),
  ('field_staff', 'vault.access');
