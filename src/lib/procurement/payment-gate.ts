import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Payment gate for procurement entry (Mitchell, 2026-07-09).
 *
 * A job only enters procurement once the customer has paid — Beaumont Hills
 * (CFA05107) went all the way to Xero POs with an unpaid $8,122 invoice.
 * Small balances don't block: the gate trips when more than $1,000 of
 * non-void invoice value is still owing on the job. Jobs already in
 * procurement before this shipped are grandfathered (the gate only guards
 * ENTRY into procurement, not existing lists).
 */
export const PROCUREMENT_UNPAID_LIMIT = 1000;

/**
 * Returns a human-readable block reason, or null when the job may enter
 * procurement. Fails CLOSED on a read error — this is a money guard.
 */
export async function procurementPaymentBlock(
  supabase: SupabaseClient,
  jobId: string,
): Promise<string | null> {
  const { data, error } = await supabase
    .from("invoices")
    .select("xero_invoice_number, amount_due")
    .eq("job_id", jobId)
    .neq("status", "void");
  if (error) {
    return `Couldn't verify invoice payment for this job (${error.message}) — try again.`;
  }

  const owing = (data ?? []).reduce((s, r) => s + Number(r.amount_due ?? 0), 0);
  if (owing <= PROCUREMENT_UNPAID_LIMIT) return null;

  const unpaidNumbers = (data ?? [])
    .filter((r) => Number(r.amount_due ?? 0) > 0)
    .map((r) => r.xero_invoice_number)
    .filter(Boolean)
    .join(", ");
  return `This job has $${owing.toFixed(2)} in unpaid invoices${
    unpaidNumbers ? ` (${unpaidNumbers})` : ""
  }. Stock can only be ordered once the customer has paid.`;
}
