// Database types — matches Supabase schema

export type StaffRole = 'admin' | 'finance_manager' | 'project_manager' | 'field_staff';
export type JobPhase = 'pre_work' | 'quoting' | 'in_progress' | 'tracking_hold' | 'completion';
export type NoteType = 'note' | 'email' | 'call' | 'system';
export type NbnStepStatus = 'pending' | 'in_progress' | 'complete' | 'skipped';
export type CategoryType = 'job_type' | 'business_unit';
export type DealStage = 'lead' | 'quote_sent' | 'accepted';
export type CustomerType = 'commercial' | 'residential' | 'government' | 'internal';

export interface Staff {
  id: string;
  email: string;
  display_name: string;
  initials: string;
  colour: string;
  role: StaffRole;
  phone: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface Category {
  id: string;
  type: CategoryType;
  name: string;
  sort_order: number;
  is_active: boolean;
  created_at: string;
}

export interface Status {
  id: string;
  name: string;
  phase: JobPhase;
  colour: string;
  sort_order: number;
  allowed_transitions: string[];
  auto_actions: Record<string, unknown>;
  created_at: string;
}

export interface Customer {
  id: string;
  name: string;
  type: CustomerType;
  parent_customer_id: string | null;
  abn: string | null;
  health_score: number;
  total_revenue: number;
  notes: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  // Joined data
  contacts?: CustomerContact[];
  sites?: CustomerSite[];
  parent_customer?: { id: string; name: string } | null;
  _job_count?: number;
}

export interface CustomerContact {
  id: string;
  customer_id: string;
  site_id: string | null;
  name: string;
  role: string | null;
  phone: string | null;
  mobile: string | null;
  email: string | null;
  is_primary: boolean;
  created_at: string;
}

export interface CustomerSite {
  id: string;
  customer_id: string;
  name: string;
  address: string | null;
  suburb: string | null;
  state: string | null;
  postcode: string | null;
  lat: number | null;
  lng: number | null;
  site_contact_id: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface Job {
  id: string;
  number: string;
  customer_id: string;
  site_id: string | null;
  job_contact_id: string | null;
  reference: string | null;
  description: string | null;
  category_1_id: string | null;
  category_2_id: string | null;
  status_id: string;
  estimated_value: number | null;
  template_id: string | null;
  priority: number;
  due_date: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  // Joined data
  customer?: Customer;
  site?: CustomerSite;
  status?: Status;
  category_1?: Category;
  category_2?: Category;
  staff?: JobStaff[];
}

export interface JobStaff {
  id: string;
  job_id: string;
  staff_id: string;
  role: string;
  colour: string | null;
  assigned_at: string;
  staff?: Staff;
}

export interface JobNote {
  id: string;
  job_id: string;
  staff_id: string | null;
  content: string;
  type: NoteType;
  created_at: string;
  staff?: Staff;
}

export interface JobTime {
  id: string;
  job_id: string;
  staff_id: string;
  start_time: string;
  end_time: string | null;
  billable: boolean;
  notes: string | null;
  created_at: string;
  staff?: Staff;
}

export interface NbnStep {
  id: string;
  job_id: string;
  step_number: number;
  name: string;
  status: NbnStepStatus;
  completed_at: string | null;
  notes: string | null;
  created_at: string;
}

export interface PipelineDeal {
  id: string;
  customer_id: string | null;
  title: string;
  description: string | null;
  stage: DealStage;
  value: number | null;
  probability: number;
  expected_close: string | null;
  contact_name: string | null;
  contact_phone: string | null;
  contact_email: string | null;
  lost_reason: string | null;
  won_job_id: string | null;
  assigned_to: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  customer?: { id: string; name: string };
  assigned_staff?: { id: string; display_name: string; initials: string; colour: string };
}

export interface ScheduleEntry {
  id: string;
  job_id: string;
  staff_id: string;
  schedule_date: string;
  start_time: string | null;
  end_time: string | null;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  job?: {
    id: string;
    number: string;
    reference: string | null;
    customer?: { id: string; name: string };
    site?: { id: string; name: string };
    status?: { id: string; name: string; colour: string };
  };
  staff?: Staff;
}
