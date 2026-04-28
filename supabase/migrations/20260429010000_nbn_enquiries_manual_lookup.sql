-- Workstream D: manual-lookup tier on nbn_enquiries + storage bucket for
-- customer-uploaded proof-of-address (lease) documents.

ALTER TABLE nbn_enquiries
  ADD COLUMN IF NOT EXISTS tier text NOT NULL DEFAULT 'standard',
  ADD COLUMN IF NOT EXISTS proof_file_url text,
  ADD COLUMN IF NOT EXISTS proof_file_name text,
  ADD COLUMN IF NOT EXISTS recurring_plan_id uuid REFERENCES recurring_plans(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS nbn_enquiries_tier_idx ON nbn_enquiries(tier) WHERE tier <> 'standard';

COMMENT ON COLUMN nbn_enquiries.tier IS
  '"standard" = Kinetix-geocoded happy path. "manual_lookup" = customer fell through the address-search net and uploaded a lease/proof for staff to look up in Kinetix backend.';
COMMENT ON COLUMN nbn_enquiries.proof_file_url IS
  'Supabase Storage path (or signed URL) for the proof-of-address document customer uploaded with a manual_lookup enquiry.';
COMMENT ON COLUMN nbn_enquiries.recurring_plan_id IS
  'When staff converts a manual_lookup enquiry into a recurring plan, the resulting plan id is stamped here so the enquiry stays linked.';

INSERT INTO storage.buckets (id, name, public)
VALUES ('enquiry-proofs', 'enquiry-proofs', false)
ON CONFLICT (id) DO NOTHING;
