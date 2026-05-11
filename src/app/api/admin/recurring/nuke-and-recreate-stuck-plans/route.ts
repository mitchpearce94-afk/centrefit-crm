import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { getAuthedClient } from "@/lib/xero/client";
import { activatePlan } from "@/lib/recurring/activate-plan";
import { isXeroRateLimited, captureXeroRateLimit } from "@/lib/xero/rate-limit";

/**
 * One-shot recovery route for the 2026-05-11 incident:
 *
 * The xero-node SDK silently retries on HTTP 429. Every retry that
 * succeeded server-side before the next 429 created a duplicate
 * RepeatingInvoice on Xero. Combined with the DAYSAFTERINVOICEDATE bug
 * burning calls on initial attempts, each of the 5 stuck plans ended up
 * with ~7 RIs in Xero (instead of the 1-2 expected) — and Xero already
 * generated a child invoice from every duplicate at creation time.
 *
 * This route, for each plan ID in the hardcoded recovery list:
 *   1. Lists every Xero RI whose Reference matches `Plan <id-prefix>`.
 *   2. For each RI found: fetches its child invoices and VOIDs them,
 *      then DELETEs the RI itself.
 *   3. Clears the plan's xero_repeating_invoice_id / secondary / xero_contact_id
 *      and resets status to `pending_mandate`.
 *   4. Calls activatePlan to recreate exactly 1-2 clean RIs per plan,
 *      using the new per-call idempotency key so SDK retries can't dup.
 *
 * Paced to stay under Xero's 60 calls/min limit:
 *   - 250ms between intra-plan Xero calls
 *   - 6s between plans (lets the per-minute window drain)
 *
 * Auth-gated. Hardcoded plan ID list — refuses to operate on anything
 * else. POST-only.
 */

export const maxDuration = 300;

const RECOVERY_PLAN_IDS = [
  "4c6caf4f-b20f-46f1-9211-d05b4c402638", // Benjamin Gunning — Snap Fitness Preston
  "629a27e9-11ab-4009-ae18-f53d7daea49f", // Benjamin Gunning — Snap Fitness Armadale
  "8d746236-9124-426d-90f7-959765978fbb", // Gavin Pereira — Snap Fitness Sunshine
  "90d96e4c-5c77-49d0-961f-c30ea2ccbc32", // Kosta Magdalinos — Snap Fitness Wantirna
  "99bbf8da-9baf-4df2-b1d9-37ddf5e3579a", // Ajit Singh — Snap Fitness Point Cook
];

const INTRA_PLAN_DELAY_MS = 250;
const INTER_PLAN_DELAY_MS = 6000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function POST() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });

  const svc = createServiceRoleClient();

  // Bail early if Xero is already in a rate-limit cooldown — re-run after.
  const limited = await isXeroRateLimited(svc);
  if (limited) {
    return NextResponse.json({
      error: `Xero rate-limited until ${limited.until.toISOString()} (${limited.reason}). Re-run after that.`,
    }, { status: 429 });
  }

  const { client: xero, conn } = await getAuthedClient(svc);
  const tenantId = conn.tenant_id;
  const results: Record<string, unknown>[] = [];

  for (let i = 0; i < RECOVERY_PLAN_IDS.length; i++) {
    const planId = RECOVERY_PLAN_IDS[i];
    if (i > 0) await sleep(INTER_PLAN_DELAY_MS);

    // Re-check the cooldown between plans in case we tripped it earlier.
    const stillLimited = await isXeroRateLimited(svc);
    if (stillLimited) {
      results.push({
        plan_id: planId,
        skipped: true,
        reason: `Xero rate-limited until ${stillLimited.until.toISOString()} — re-run after that to continue`,
      });
      continue;
    }

    const planResult: Record<string, unknown> = { plan_id: planId };

    try {
      // 1. Look up plan basics.
      const { data: plan } = await svc
        .from("recurring_plans")
        .select("id, customer_id, first_invoice_date, customers(name)")
        .eq("id", planId)
        .single();
      if (!plan) {
        planResult.error = "plan not found";
        results.push(planResult);
        continue;
      }
      const customer = Array.isArray(plan.customers) ? plan.customers[0] : plan.customers;
      planResult.customer = customer?.name ?? null;
      planResult.first_invoice_date = plan.first_invoice_date;

      // 2. List every Xero RI for this plan (Reference == "Plan <id-prefix>").
      const reference = `Plan ${planId.slice(0, 8)}`;
      await sleep(INTRA_PLAN_DELAY_MS);
      const riList = await xero.accountingApi.getRepeatingInvoices(
        tenantId,
        `Reference == "${reference}"`,
      );
      const ris = riList.body.repeatingInvoices ?? [];
      planResult.ris_found = ris.length;

      // 3. For each RI: void its children, then delete it.
      const voidedInvoiceIds: string[] = [];
      const deletedRiIds: string[] = [];

      for (const ri of ris) {
        const riId = ri.repeatingInvoiceID;
        if (!riId) continue;

        // Find every child invoice this RI generated. AUTHORISED is the
        // only state we expect to find (childStatus on the template).
        await sleep(INTRA_PLAN_DELAY_MS);
        const childList = await xero.accountingApi.getInvoices(
          tenantId,
          undefined, // ifModifiedSince
          `RepeatingInvoiceID == Guid("${riId}")`,
        );
        const children = childList.body.invoices ?? [];

        for (const child of children) {
          if (!child.invoiceID) continue;
          // Skip already-VOIDED or PAID; we only want to void open ones.
          const status = String(child.status ?? "");
          if (status === "VOIDED" || status === "PAID") continue;
          await sleep(INTRA_PLAN_DELAY_MS);
          await xero.accountingApi.updateInvoice(tenantId, child.invoiceID, {
            invoices: [{ status: "VOIDED" } as never],
          });
          voidedInvoiceIds.push(child.invoiceID);
        }

        // Cancel (status=DELETED) the RI itself.
        await sleep(INTRA_PLAN_DELAY_MS);
        await xero.accountingApi.updateRepeatingInvoice(tenantId, riId, {
          repeatingInvoices: [{ status: "DELETED" } as never],
        });
        deletedRiIds.push(riId);
      }

      planResult.invoices_voided = voidedInvoiceIds.length;
      planResult.ris_deleted = deletedRiIds.length;

      // 4. Reset plan state so activatePlan runs cleanly.
      await svc
        .from("recurring_plans")
        .update({
          status: "pending_mandate",
          xero_repeating_invoice_id: null,
          xero_repeating_invoice_secondary_id: null,
          xero_contact_id: null,
          next_invoice_date: null,
        })
        .eq("id", planId);

      // 5. Recreate via activatePlan (uses fresh idempotency keys).
      await sleep(INTRA_PLAN_DELAY_MS);
      const activated = await activatePlan(svc, planId);
      planResult.activated = activated;
    } catch (err) {
      // Persist rate-limit cooldown if that's what we hit, then surface
      // and continue to the next plan (it'll skip via the check above).
      const wasRateLimit = await captureXeroRateLimit(svc, err);
      planResult.error = err instanceof Error ? err.message : String(err);
      planResult.rate_limited = wasRateLimit;
    }

    results.push(planResult);
  }

  return NextResponse.json({ processed: results.length, results });
}
