-- ============================================================================
-- CENTREFIT CRM — Phase 1 Database Schema
-- Foundation: Auth, Staff, Customers, Jobs, State Machine
-- ============================================================================

-- ============================================================================
-- 1. ENUMS
-- ============================================================================

CREATE TYPE public.staff_role AS ENUM (
  'admin',
  'finance_manager',
  'project_manager',
  'field_staff'
);

CREATE TYPE public.job_phase AS ENUM (
  'pre_work',
  'quoting',
  'in_progress',
  'tracking_hold',
  'completion'
);

CREATE TYPE public.note_type AS ENUM (
  'note',
  'email',
  'call',
  'system'
);

CREATE TYPE public.nbn_step_status AS ENUM (
  'pending',
  'in_progress',
  'complete',
  'skipped'
);

CREATE TYPE public.category_type AS ENUM (
  'job_type',       -- Category 1: IT Install, Service, NBN, etc.
  'business_unit'   -- Category 2: Solutions, Communications, Services
);

CREATE TYPE public.customer_type AS ENUM (
  'commercial',
  'residential',
  'government',
  'internal'
);

-- ============================================================================
-- 2. STAFF (extends auth.users)
-- ============================================================================

CREATE TABLE public.staff (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  display_name TEXT NOT NULL,
  initials TEXT NOT NULL,
  colour TEXT NOT NULL DEFAULT '#3b82f6',
  role public.staff_role NOT NULL DEFAULT 'field_staff',
  phone TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_staff_role ON public.staff(role);
CREATE INDEX idx_staff_active ON public.staff(is_active) WHERE is_active = true;

-- ============================================================================
-- 3. CATEGORIES (dual category system from Tradify)
-- ============================================================================

CREATE TABLE public.categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type public.category_type NOT NULL,
  name TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(type, name)
);

CREATE INDEX idx_categories_type ON public.categories(type);

-- ============================================================================
-- 4. STATUSES (5-phase state machine)
-- ============================================================================

CREATE TABLE public.statuses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL UNIQUE,
  phase public.job_phase NOT NULL,
  colour TEXT NOT NULL DEFAULT '#6b7280',
  sort_order INTEGER NOT NULL DEFAULT 0,
  -- JSON array of valid next status names for state machine enforcement
  allowed_transitions UUID[] DEFAULT '{}',
  -- Optional automation config (e.g., auto-follow-up timers)
  auto_actions JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_statuses_phase ON public.statuses(phase);

-- ============================================================================
-- 5. CUSTOMERS
-- ============================================================================

CREATE TABLE public.customers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  type public.customer_type NOT NULL DEFAULT 'commercial',
  -- Self-referencing for parent/child grouping (Snap Fitness locations under brand)
  parent_customer_id UUID REFERENCES public.customers(id) ON DELETE SET NULL,
  abn TEXT,
  health_score INTEGER DEFAULT 0,
  total_revenue NUMERIC(12,2) DEFAULT 0,
  notes TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_customers_parent ON public.customers(parent_customer_id) WHERE parent_customer_id IS NOT NULL;
CREATE INDEX idx_customers_name ON public.customers(name);
CREATE INDEX idx_customers_active ON public.customers(is_active) WHERE is_active = true;

-- ============================================================================
-- 6. CUSTOMER CONTACTS
-- ============================================================================

CREATE TABLE public.customer_contacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  role TEXT,
  phone TEXT,
  mobile TEXT,
  email TEXT,
  is_primary BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_contacts_customer ON public.customer_contacts(customer_id);

-- ============================================================================
-- 7. CUSTOMER SITES
-- ============================================================================

CREATE TABLE public.customer_sites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  address TEXT,
  suburb TEXT,
  state TEXT,
  postcode TEXT,
  lat DOUBLE PRECISION,
  lng DOUBLE PRECISION,
  site_contact_id UUID REFERENCES public.customer_contacts(id) ON DELETE SET NULL,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_sites_customer ON public.customer_sites(customer_id);

-- ============================================================================
-- 8. JOB NUMBER SEQUENCE (CFA-XXXXX)
-- ============================================================================

CREATE SEQUENCE public.job_number_seq START WITH 5011;
-- Starting at 5011 to continue after 5,010 existing Tradify jobs

-- ============================================================================
-- 9. JOBS
-- ============================================================================

CREATE TABLE public.jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- CFA-prefixed sequential number, auto-generated
  number TEXT NOT NULL UNIQUE,
  customer_id UUID NOT NULL REFERENCES public.customers(id) ON DELETE RESTRICT,
  site_id UUID REFERENCES public.customer_sites(id) ON DELETE SET NULL,
  -- Dual contact system: job contact vs site contact
  job_contact_id UUID REFERENCES public.customer_contacts(id) ON DELETE SET NULL,
  reference TEXT,
  description TEXT,
  -- Dual category system
  category_1_id UUID REFERENCES public.categories(id) ON DELETE SET NULL,
  category_2_id UUID REFERENCES public.categories(id) ON DELETE SET NULL,
  status_id UUID NOT NULL REFERENCES public.statuses(id) ON DELETE RESTRICT,
  -- Job value tracking
  estimated_value NUMERIC(12,2),
  -- Template this job was created from (if any)
  template_id UUID,
  priority INTEGER NOT NULL DEFAULT 0,
  due_date DATE,
  created_by UUID REFERENCES public.staff(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_jobs_customer ON public.jobs(customer_id);
CREATE INDEX idx_jobs_site ON public.jobs(site_id);
CREATE INDEX idx_jobs_status ON public.jobs(status_id);
CREATE INDEX idx_jobs_cat1 ON public.jobs(category_1_id);
CREATE INDEX idx_jobs_cat2 ON public.jobs(category_2_id);
CREATE INDEX idx_jobs_number ON public.jobs(number);
CREATE INDEX idx_jobs_due_date ON public.jobs(due_date) WHERE due_date IS NOT NULL;
CREATE INDEX idx_jobs_created ON public.jobs(created_at DESC);

-- Auto-generate CFA job number on insert
CREATE OR REPLACE FUNCTION public.generate_job_number()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.number IS NULL OR NEW.number = '' THEN
    NEW.number := 'CFA' || LPAD(nextval('public.job_number_seq')::TEXT, 5, '0');
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_job_number
  BEFORE INSERT ON public.jobs
  FOR EACH ROW
  EXECUTE FUNCTION public.generate_job_number();

-- ============================================================================
-- 10. JOB STAFF (many-to-many assignment)
-- ============================================================================

CREATE TABLE public.job_staff (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  staff_id UUID NOT NULL REFERENCES public.staff(id) ON DELETE CASCADE,
  role TEXT DEFAULT 'assigned',
  colour TEXT,
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(job_id, staff_id)
);

CREATE INDEX idx_job_staff_job ON public.job_staff(job_id);
CREATE INDEX idx_job_staff_staff ON public.job_staff(staff_id);

-- ============================================================================
-- 11. JOB NOTES (activity log)
-- ============================================================================

CREATE TABLE public.job_notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  staff_id UUID REFERENCES public.staff(id) ON DELETE SET NULL,
  content TEXT NOT NULL,
  type public.note_type NOT NULL DEFAULT 'note',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_job_notes_job ON public.job_notes(job_id);
CREATE INDEX idx_job_notes_created ON public.job_notes(job_id, created_at DESC);

-- ============================================================================
-- 12. JOB TIME (time tracking)
-- ============================================================================

CREATE TABLE public.job_time (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  staff_id UUID NOT NULL REFERENCES public.staff(id) ON DELETE CASCADE,
  start_time TIMESTAMPTZ NOT NULL,
  end_time TIMESTAMPTZ,
  billable BOOLEAN NOT NULL DEFAULT true,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_job_time_job ON public.job_time(job_id);
CREATE INDEX idx_job_time_staff ON public.job_time(staff_id);
CREATE INDEX idx_job_time_open ON public.job_time(staff_id) WHERE end_time IS NULL;

-- ============================================================================
-- 13. NBN STEPS (replaces 11-category hack)
-- ============================================================================

CREATE TABLE public.nbn_steps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  step_number INTEGER NOT NULL CHECK (step_number BETWEEN 1 AND 11),
  name TEXT NOT NULL,
  status public.nbn_step_status NOT NULL DEFAULT 'pending',
  completed_at TIMESTAMPTZ,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(job_id, step_number)
);

CREATE INDEX idx_nbn_steps_job ON public.nbn_steps(job_id);

-- ============================================================================
-- 14. UPDATED_AT TRIGGER (auto-update timestamps)
-- ============================================================================

CREATE OR REPLACE FUNCTION public.handle_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.staff
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.customers
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.customer_sites
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.jobs
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- ============================================================================
-- 15. ROW LEVEL SECURITY
-- ============================================================================

ALTER TABLE public.staff ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.statuses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_sites ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.job_staff ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.job_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.job_time ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.nbn_steps ENABLE ROW LEVEL SECURITY;

-- Helper: check if current user is admin
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.staff
    WHERE id = auth.uid() AND role = 'admin'
  );
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- Helper: check if current user is admin or finance_manager
CREATE OR REPLACE FUNCTION public.is_admin_or_finance()
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.staff
    WHERE id = auth.uid() AND role IN ('admin', 'finance_manager')
  );
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- STAFF: all authenticated can read, only admin can modify
CREATE POLICY "staff_select" ON public.staff FOR SELECT TO authenticated USING (true);
CREATE POLICY "staff_insert" ON public.staff FOR INSERT TO authenticated WITH CHECK (public.is_admin());
CREATE POLICY "staff_update" ON public.staff FOR UPDATE TO authenticated USING (public.is_admin());
CREATE POLICY "staff_delete" ON public.staff FOR DELETE TO authenticated USING (public.is_admin());

-- CATEGORIES: all authenticated can read, only admin can modify
CREATE POLICY "categories_select" ON public.categories FOR SELECT TO authenticated USING (true);
CREATE POLICY "categories_modify" ON public.categories FOR ALL TO authenticated USING (public.is_admin());

-- STATUSES: all authenticated can read, only admin can modify
CREATE POLICY "statuses_select" ON public.statuses FOR SELECT TO authenticated USING (true);
CREATE POLICY "statuses_modify" ON public.statuses FOR ALL TO authenticated USING (public.is_admin());

-- CUSTOMERS: all authenticated can read, admin + PM can modify
CREATE POLICY "customers_select" ON public.customers FOR SELECT TO authenticated USING (true);
CREATE POLICY "customers_insert" ON public.customers FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "customers_update" ON public.customers FOR UPDATE TO authenticated USING (true);
CREATE POLICY "customers_delete" ON public.customers FOR DELETE TO authenticated USING (public.is_admin());

-- CUSTOMER CONTACTS: follows customer access
CREATE POLICY "contacts_select" ON public.customer_contacts FOR SELECT TO authenticated USING (true);
CREATE POLICY "contacts_insert" ON public.customer_contacts FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "contacts_update" ON public.customer_contacts FOR UPDATE TO authenticated USING (true);
CREATE POLICY "contacts_delete" ON public.customer_contacts FOR DELETE TO authenticated USING (public.is_admin());

-- CUSTOMER SITES: follows customer access
CREATE POLICY "sites_select" ON public.customer_sites FOR SELECT TO authenticated USING (true);
CREATE POLICY "sites_insert" ON public.customer_sites FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "sites_update" ON public.customer_sites FOR UPDATE TO authenticated USING (true);
CREATE POLICY "sites_delete" ON public.customer_sites FOR DELETE TO authenticated USING (public.is_admin());

-- JOBS: all authenticated can read, all can create/update
CREATE POLICY "jobs_select" ON public.jobs FOR SELECT TO authenticated USING (true);
CREATE POLICY "jobs_insert" ON public.jobs FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "jobs_update" ON public.jobs FOR UPDATE TO authenticated USING (true);
CREATE POLICY "jobs_delete" ON public.jobs FOR DELETE TO authenticated USING (public.is_admin());

-- JOB STAFF: follows job access
CREATE POLICY "job_staff_select" ON public.job_staff FOR SELECT TO authenticated USING (true);
CREATE POLICY "job_staff_insert" ON public.job_staff FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "job_staff_update" ON public.job_staff FOR UPDATE TO authenticated USING (true);
CREATE POLICY "job_staff_delete" ON public.job_staff FOR DELETE TO authenticated USING (true);

-- JOB NOTES: all can read and create, only author or admin can delete
CREATE POLICY "job_notes_select" ON public.job_notes FOR SELECT TO authenticated USING (true);
CREATE POLICY "job_notes_insert" ON public.job_notes FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "job_notes_delete" ON public.job_notes FOR DELETE TO authenticated
  USING (staff_id = auth.uid() OR public.is_admin());

-- JOB TIME: staff can manage own entries, admin sees all
CREATE POLICY "job_time_select" ON public.job_time FOR SELECT TO authenticated USING (true);
CREATE POLICY "job_time_insert" ON public.job_time FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "job_time_update" ON public.job_time FOR UPDATE TO authenticated
  USING (staff_id = auth.uid() OR public.is_admin());
CREATE POLICY "job_time_delete" ON public.job_time FOR DELETE TO authenticated
  USING (staff_id = auth.uid() OR public.is_admin());

-- NBN STEPS: follows job access
CREATE POLICY "nbn_steps_select" ON public.nbn_steps FOR SELECT TO authenticated USING (true);
CREATE POLICY "nbn_steps_insert" ON public.nbn_steps FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "nbn_steps_update" ON public.nbn_steps FOR UPDATE TO authenticated USING (true);
CREATE POLICY "nbn_steps_delete" ON public.nbn_steps FOR DELETE TO authenticated USING (public.is_admin());

-- ============================================================================
-- 16. SEED DATA
-- ============================================================================

-- Categories: Job Type (Category 1)
INSERT INTO public.categories (type, name, sort_order) VALUES
  ('job_type', 'IT Supply & Install', 1),
  ('job_type', 'IT Related Service', 2),
  ('job_type', 'IT Site Visit', 3),
  ('job_type', 'IT Support', 4),
  ('job_type', 'Security Install', 5),
  ('job_type', 'Security Service', 6),
  ('job_type', 'NBN Internet Onboarding', 7),
  ('job_type', 'Audio Install', 8),
  ('job_type', 'Audio Service', 9),
  ('job_type', 'AV Install', 10),
  ('job_type', 'Access Control Install', 11),
  ('job_type', 'Access Control Service', 12),
  ('job_type', 'Consultancy', 13),
  ('job_type', 'Project Management', 14),
  ('job_type', 'Maintenance', 15);

-- Categories: Business Unit (Category 2)
INSERT INTO public.categories (type, name, sort_order) VALUES
  ('business_unit', 'Solutions', 1),
  ('business_unit', 'Communications', 2),
  ('business_unit', 'Services', 3);

-- Statuses: Pre-Work phase
INSERT INTO public.statuses (name, phase, colour, sort_order) VALUES
  ('Lead / Unassigned', 'pre_work', '#6b7280', 1),
  ('Assigned', 'pre_work', '#3b82f6', 2),
  ('Pending Schedule', 'pre_work', '#8b5cf6', 3),
  ('Scheduled', 'pre_work', '#06b6d4', 4);

-- Statuses: Quoting phase
INSERT INTO public.statuses (name, phase, colour, sort_order) VALUES
  ('Quote Draft', 'quoting', '#f59e0b', 10),
  ('Sub-Quote Needed', 'quoting', '#f97316', 11),
  ('Quote Sent', 'quoting', '#eab308', 12),
  ('Quote Expired', 'quoting', '#78716c', 13);

-- Statuses: In Progress phase
INSERT INTO public.statuses (name, phase, colour, sort_order) VALUES
  ('In Progress', 'in_progress', '#22c55e', 20),
  ('Design Phase', 'in_progress', '#14b8a6', 21),
  ('Awaiting Approval', 'in_progress', '#f59e0b', 22),
  ('Rough In', 'in_progress', '#a855f7', 23),
  ('Fit Off', 'in_progress', '#8b5cf6', 24),
  ('Equipment Build', 'in_progress', '#6366f1', 25),
  ('IT Service Active', 'in_progress', '#10b981', 26),
  ('NBN Active', 'in_progress', '#0ea5e9', 27);

-- Statuses: Tracking & Hold phase
INSERT INTO public.statuses (name, phase, colour, sort_order) VALUES
  ('Follow Up', 'tracking_hold', '#f59e0b', 30),
  ('On Hold', 'tracking_hold', '#ef4444', 31),
  ('Parts Dispatched', 'tracking_hold', '#f97316', 32),
  ('Parts Needed', 'tracking_hold', '#dc2626', 33),
  ('Pending Tech', 'tracking_hold', '#fb923c', 34);

-- Statuses: Completion phase
INSERT INTO public.statuses (name, phase, colour, sort_order) VALUES
  ('Ready to Invoice', 'completion', '#84cc16', 40),
  ('Invoice Sent', 'completion', '#22d3ee', 41),
  ('Complete', 'completion', '#16a34a', 42),
  ('Cancelled', 'completion', '#64748b', 43);
