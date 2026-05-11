import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { getAuthedClient } from "@/lib/xero/client";

/**
 * Patch each of the 5 recovery plans' RepeatingInvoices to set
 * `includePDF: true` so future auto-generated child invoices arrive in the
 * customer's inbox as a PDF attachment rather than just a "view online"
 * link.
 *
 * Reads the canonical RI IDs from `recurring_plans.xero_repeating_invoice_id`
 * + `xero_repeating_invoice_secondary_id` so we touch the exact 7 RIs that
 * exist, no more.
 *
 * Auth-gated. ~7 Xero PATCH calls, paced 500ms apart. No customer-facing
 * effect (this is a template-config-only change).
 */

const RECOVERY_PLAN_IDS = [
  "4c6caf4f-b20f-46f1-9211-d05b4c402638",
  "629a27e9-11ab-4009-ae18-f53d7daea49f",
  "8d746236-9124-426d-90f7-959765978fbb",
  "90d96e4c-5c77-49d0-961f-c30ea2ccbc32",
  "99bbf8da-9baf-4df2-b1d9-37ddf5e3579a",
];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });

  const svc = createServiceRoleClient();
  const { data: plans } = await svc
    .from("recurring_plans")
    .select("id, xero_repeating_invoice_id, xero_repeating_invoice_secondary_id")
    .in("id", RECOVERY_PLAN_IDS);

  const riIds: string[] = [];
  for (const p of plans ?? []) {
    if (p.xero_repeating_invoice_id) riIds.push(p.xero_repeating_invoice_id);
    if (p.xero_repeating_invoice_secondary_id) riIds.push(p.xero_repeating_invoice_secondary_id);
  }

  const { client: xero, conn } = await getAuthedClient(svc);
  const results: unknown[] = [];

  for (let i = 0; i < riIds.length; i++) {
    if (i > 0) await sleep(500);
    const riId = riIds[i];
    try {
      await xero.accountingApi.updateRepeatingInvoice(conn.tenant_id, riId, {
        repeatingInvoices: [{ includePDF: true } as never],
      });
      results.push({ riId, ok: true });
    } catch (err) {
      const errStr = err instanceof Error ? err.message : (() => {
        try { return JSON.stringify(err); } catch { return String(err); }
      })();
      results.push({ riId, ok: false, error: errStr.slice(0, 2000) });
    }
  }

  return NextResponse.json({ patched: results.length, results });
}
