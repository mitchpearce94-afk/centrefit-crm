-- =============================================================================
-- jobs.procurement_gate_waived_* — per-job waiver of the procurement payment
-- gate (Mitchell, 2026-10-20)
-- =============================================================================
-- The payment gate (lib/procurement/payment-gate.ts, 2026-07-09) stops a job
-- entering procurement while > $1,000 of its invoices are unpaid. Sometimes
-- Mitchell wants stock ordered anyway — Planet Fitness Bundaberg (CFA05252)
-- are paying PP1 next Thursday and the kit needs to be on its way now.
--
-- A waiver is set by Mitchell only (API route checks the owner email), is
-- stamped with who/when/why, and is honoured by both gates: the API entry
-- check and the procurement board's "waiting on PP1" hold.
-- =============================================================================

ALTER TABLE public.jobs
  ADD COLUMN IF NOT EXISTS procurement_gate_waived_at   timestamptz,
  ADD COLUMN IF NOT EXISTS procurement_gate_waived_by   uuid REFERENCES public.staff(id),
  ADD COLUMN IF NOT EXISTS procurement_gate_waiver_note text;
