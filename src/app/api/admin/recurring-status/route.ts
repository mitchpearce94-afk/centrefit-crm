import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getAuthedClient } from "@/lib/xero/client";
import { getRepeatingInvoice } from "@/lib/xero/repeating-invoices";

/**
 * GET /api/admin/recurring-status
 *
 * Admin-only diagnostic. Walks every plan in (active, pending_mandate) and
 * fetches the current state of its Xero RepeatingInvoice template(s) so we
 * can verify before a scheduled charge date that the plan will actually
 * fire + auto-email. READ-ONLY — never touches customer-facing state.
 *
 * Surfaces the four things that matter for "will this fire on the
 * scheduled date":
 *   1. status — DRAFT vs AUTHORISED (DRAFT templates do NOT auto-fire)
 *   2. nextScheduledDate — what Xero thinks the next run is
 *   3. brandingThemeID — should be Solutions DD or Communications DD
 *   4. approvedForSending — children auto-email when generated
 */
export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });

  const { data: me } = await supabase
    .from("staff")
    .select("role")
    .eq("id", user.id)
    .single();
  if (me?.role !== "admin") {
    return NextResponse.json({ error: "Admin only" }, { status: 403 });
  }

  const { data: plans, error } = await supabase
    .from("recurring_plans")
    .select(`
      id, status, first_invoice_date, next_invoice_date,
      xero_repeating_invoice_id, xero_repeating_invoice_secondary_id,
      gc_mandate_id,
      customer:customers(name), site:customer_sites(name)
    `)
    .in("status", ["active", "pending_mandate"])
    .order("next_invoice_date", { ascending: true, nullsFirst: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Branding theme env vars so we can label which theme each RI is using.
  const themes = {
    [process.env.XERO_BRANDING_THEME_COMMUNICATIONS_DD_ID ?? ""]: "Comms DD",
    [process.env.XERO_BRANDING_THEME_SOLUTIONS_DD_ID ?? ""]: "Solutions DD",
  };

  let xero: Awaited<ReturnType<typeof getAuthedClient>>["client"] | null = null;
  let tenantId: string | null = null;
  try {
    const auth = await getAuthedClient(supabase);
    xero = auth.client;
    tenantId = auth.conn.tenant_id;
  } catch (e) {
    return NextResponse.json({
      error: `Xero auth failed: ${e instanceof Error ? e.message : String(e)}`,
      hint: "Run the Xero re-auth flow (/api/xero/auth) before retrying.",
    }, { status: 502 });
  }

  const results = await Promise.all(
    (plans ?? []).map(async (p) => {
      const customer = Array.isArray(p.customer) ? p.customer[0] : p.customer;
      const site = Array.isArray(p.site) ? p.site[0] : p.site;
      const xeroIds = [p.xero_repeating_invoice_id, p.xero_repeating_invoice_secondary_id]
        .filter((id): id is string => !!id);
      const xeroStates = await Promise.all(
        xeroIds.map(async (id) => {
          try {
            const state = await getRepeatingInvoice(xero!, tenantId!, id);
            return {
              ...state,
              brandingThemeLabel: themes[state.brandingThemeID ?? ""] ?? "unknown",
              willFireAutomatically: state.status === "AUTHORISED",
              willAutoEmail: state.status === "AUTHORISED" && !!state.approvedForSending,
            };
          } catch (e) {
            return {
              repeatingInvoiceID: id,
              error: e instanceof Error ? e.message : String(e),
            };
          }
        }),
      );
      return {
        planId: p.id,
        planStatus: p.status,
        customer: customer?.name ?? null,
        site: site?.name ?? null,
        firstInvoiceDate: p.first_invoice_date,
        nextInvoiceDate: p.next_invoice_date,
        gcMandateId: p.gc_mandate_id,
        xero: xeroStates,
      };
    }),
  );

  return NextResponse.json({
    checkedAt: new Date().toISOString(),
    planCount: results.length,
    plans: results,
  });
}
