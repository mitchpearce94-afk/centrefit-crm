-- Checklist templates — reusable task lists for different job types
CREATE TABLE public.checklist_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT,
  -- JSONB array of task objects:
  -- [{ task_number, title, sub_items: string[] }]
  items JSONB NOT NULL DEFAULT '[]',
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.checklist_templates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "checklist_templates_select" ON public.checklist_templates FOR SELECT TO authenticated USING (true);
CREATE POLICY "checklist_templates_modify" ON public.checklist_templates FOR ALL TO authenticated USING (public.is_admin());

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.checklist_templates
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- Job checklist items — individual task instances on a job
CREATE TABLE public.job_checklist_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  template_id UUID REFERENCES public.checklist_templates(id) ON DELETE SET NULL,
  task_number INTEGER NOT NULL,
  title TEXT NOT NULL,
  sub_items JSONB DEFAULT '[]',
  is_completed BOOLEAN NOT NULL DEFAULT false,
  -- "Completed by MM & MJP 28-30/10/25" — free text to handle multi-tech, date ranges
  completed_by_text TEXT,
  completed_at TIMESTAMPTZ,
  completed_by_staff_id UUID REFERENCES public.staff(id) ON DELETE SET NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_job_checklist_job ON public.job_checklist_items(job_id);
CREATE INDEX idx_job_checklist_sort ON public.job_checklist_items(job_id, sort_order);

ALTER TABLE public.job_checklist_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "job_checklist_select" ON public.job_checklist_items FOR SELECT TO authenticated USING (true);
CREATE POLICY "job_checklist_insert" ON public.job_checklist_items FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "job_checklist_update" ON public.job_checklist_items FOR UPDATE TO authenticated USING (true);
CREATE POLICY "job_checklist_delete" ON public.job_checklist_items FOR DELETE TO authenticated USING (public.is_admin());

-- Seed: Snap Fitness Full Fitout template (from Installation Day Guide)
INSERT INTO public.checklist_templates (name, description, items) VALUES (
  'Snap Fitness Full Fitout',
  'Standard installation procedure for a new Snap Fitness club build. 14 tasks covering cable verification through to customer handover.',
  '[
    {
      "task_number": 1,
      "title": "Double checking all cables have been pulled out of the wall and are in their correct locations.",
      "sub_items": []
    },
    {
      "task_number": 2,
      "title": "Build the Server Cabinet & Alarm Panel. This includes the following:",
      "sub_items": [
        "Install the Amplifier, Nightlife Media Player, NVR, Monitor and UPS.",
        "Cable manage all the power cords.",
        "Configure AP, router, amp & Switches."
      ]
    },
    {
      "task_number": 3,
      "title": "Sort all cables out between CCTV, Data and Automation in the server room and install the alarm panel on the wall.",
      "sub_items": []
    },
    {
      "task_number": 4,
      "title": "Terminate and mount all cameras (RJ45s), PIRs (6 core) and speakers (2 core) around the facility.",
      "sub_items": []
    },
    {
      "task_number": 5,
      "title": "Mount all peripherals around the facility:",
      "sub_items": [
        "Duress intercom",
        "Duress button",
        "REX at reception",
        "Card reader / door striker / REX (if required) at door/s",
        "RF Receiver",
        "Outdoor siren (if required)",
        "Nightlife Kiosk"
      ]
    },
    {
      "task_number": 6,
      "title": "Terminate and split all AV cables in the facility either in the roof space or at the server cabinet, this includes the following:",
      "sub_items": [
        "AV cables terminated at the splitter from the Cardio equipment",
        "AV cables terminated at the splitter coming from the wall mounted TVs"
      ]
    },
    {
      "task_number": 7,
      "title": "Fit off all the cables for the server cabinet. This includes the following:",
      "sub_items": [
        "Terminate all RJ45s for the cameras and data cables",
        "Terminate all RG6 coaxial cables. Identify which is the Free To Air cable coming from antenna and split the modulators accordingly",
        "Wire in all automation from the alarm panel"
      ]
    },
    {
      "task_number": 8,
      "title": "Mount all TV brackets and mount the TVs on the wall. Ensure the power and coaxial has been terminated by the electrician.",
      "sub_items": []
    },
    {
      "task_number": 9,
      "title": "Start up all systems and perform tests on the entire system:",
      "sub_items": [
        "Set up NVR and check all cameras including date, time and permissions for Staff.",
        "Test the Duress system, 3/5 x Pendants and the Duress button in the DWC.",
        "Test lighting & sound with an alarm panel. (If Applicable)",
        "Test access control including club wake up from all doors.",
        "Test REX buttons at all locations.",
        "Complete Walk Test on Alarm Keypad for ALL PIRS"
      ]
    },
    {
      "task_number": 10,
      "title": "Ensure handover has been completed with the client and the handover checklist has been completed.",
      "sub_items": []
    },
    {
      "task_number": 11,
      "title": "Ensure Completed Installation Guide (PDF Version), Installation Receipts & Installation Photos have been uploaded.",
      "sub_items": []
    },
    {
      "task_number": 12,
      "title": "Add Start & Finish dates to the job.",
      "sub_items": []
    },
    {
      "task_number": 13,
      "title": "Where applicable, add any extra information/anomalies and variances not included in this checklist into the Work Log.",
      "sub_items": []
    },
    {
      "task_number": 14,
      "title": "Provide the customer with handover documents once the build has been completed.",
      "sub_items": []
    }
  ]'::jsonb
);
