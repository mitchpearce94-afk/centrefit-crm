import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  listMandates,
  getMandate,
  getCustomerBankAccount,
  GoCardlessApiError,
} from "@/lib/gocardless/client";

/**
 * GET /api/gc/mandates?customer_id=<centrefit_customer_uuid>
 *
 * Returns the GoCardless mandates we can offer when staff want to attach an
 * existing mandate to a new recurring plan (the customer has previously
 * signed a mandate via Centrefit and we want to reuse it).
 *
 * Discovery strategy:
 *   1. Pull every distinct gc_customer_id we've ever seen for this Centrefit
 *      customer from recurring_plans.
 *   2. For each, list mandates in (active, pending_submission, submitted)
 *      status — those are the ones safe to charge against.
 *   3. Enrich with bank info (last 4 + bank name) so the picker shows
 *      something a human can verify.
 *
 * If the customer has never had a Centrefit-issued mandate we return an
 * empty list — the wizard falls back to the manual paste field.
 *
 * Also supports POST with { mandateId } for the manual-paste case — we
 * verify the mandate exists, enrich it, and return the same shape.
 */

interface MandateOption {
  mandate_id: string;
  gc_customer_id: string;
  scheme: string;
  status: string;
  reference: string | null;
  created_at: string;
  bank_name: string | null;
  account_last4: string | null;
}

export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });

  const customerId = req.nextUrl.searchParams.get("customer_id");
  if (!customerId) {
    return NextResponse.json({ error: "customer_id query param required" }, { status: 400 });
  }

  // Pull every gc_customer_id we've ever recorded for this Centrefit customer.
  const { data: priorPlans, error: priorErr } = await supabase
    .from("recurring_plans")
    .select("gc_customer_id")
    .eq("customer_id", customerId)
    .not("gc_customer_id", "is", null);
  if (priorErr) {
    return NextResponse.json({ error: priorErr.message }, { status: 500 });
  }

  const gcCustomerIds = Array.from(new Set(
    (priorPlans ?? []).map((p) => p.gc_customer_id as string).filter(Boolean),
  ));

  if (gcCustomerIds.length === 0) {
    return NextResponse.json({ mandates: [] as MandateOption[] });
  }

  // List active-ish mandates per GC customer in parallel.
  const allMandates = (
    await Promise.all(
      gcCustomerIds.map((gcId) =>
        listMandates({
          customerId: gcId,
          status: ["active", "pending_submission", "submitted"],
          limit: 25,
        }).catch((e: unknown) => {
          // Don't fail the whole call if one customer 404s — just log + skip.
          console.error("listMandates failed for", gcId, e);
          return [];
        }),
      ),
    )
  ).flat();

  // Enrich with bank info — one extra fetch per mandate. Bounded to N <= 50
  // in practice (few customers will have many active mandates).
  const enriched: MandateOption[] = await Promise.all(
    allMandates.map(async (m) => {
      let bankName: string | null = null;
      let last4: string | null = null;
      try {
        const ba = await getCustomerBankAccount(m.links.customer_bank_account);
        bankName = ba.bank_name;
        last4 = ba.account_number_ending;
      } catch {
        // Swallow — bank info is nice-to-have, not blocking.
      }
      return {
        mandate_id: m.id,
        gc_customer_id: m.links.customer,
        scheme: m.scheme,
        status: m.status,
        reference: m.reference,
        created_at: m.created_at,
        bank_name: bankName,
        account_last4: last4,
      };
    }),
  );

  // Newest first.
  enriched.sort((a, b) => b.created_at.localeCompare(a.created_at));

  return NextResponse.json({ mandates: enriched });
}

/**
 * POST body: { mandateId: string }
 * Manual-paste verification path. Looks up the mandate by ID, returns the
 * same enriched shape (or 404 if it doesn't exist in GoCardless).
 */
export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });

  let body: { mandateId?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  if (!body.mandateId) return NextResponse.json({ error: "mandateId required" }, { status: 400 });

  try {
    const m = await getMandate(body.mandateId);
    let bankName: string | null = null;
    let last4: string | null = null;
    try {
      const ba = await getCustomerBankAccount(m.links.customer_bank_account);
      bankName = ba.bank_name;
      last4 = ba.account_number_ending;
    } catch {
      // ignore
    }
    return NextResponse.json({
      mandate: {
        mandate_id: m.id,
        gc_customer_id: m.links.customer,
        scheme: m.scheme,
        status: m.status,
        reference: m.reference,
        created_at: m.created_at,
        bank_name: bankName,
        account_last4: last4,
      } satisfies MandateOption,
    });
  } catch (e) {
    if (e instanceof GoCardlessApiError && e.status === 404) {
      return NextResponse.json({ error: "Mandate not found in GoCardless" }, { status: 404 });
    }
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "GC lookup failed" },
      { status: 502 },
    );
  }
}
