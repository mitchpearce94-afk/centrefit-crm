import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { activatePlan } from "@/lib/recurring/activate-plan";

/**
 * Activate ONE specific recurring plan. Hardcoded allow-list of plan IDs
 * so this route can only touch the 2026-05-11 recovery set — refuses any
 * other plan ID outright.
 *
 * GET so Mitchell can trigger it by visiting the URL in the browser
 * address bar (no console paste required). Returns the new RepeatingInvoice
 * IDs + start date so Mitchell can verify the result in Xero before moving
 * to the next plan.
 *
 * Auth-gated. One Xero RI create per cadence (1-2 calls total). DRAFT
 * children by default — nothing emails until manually authorised.
 */

const RECOVERY_ALLOW_LIST = new Set([
  "4c6caf4f-b20f-46f1-9211-d05b4c402638", // Benjamin Gunning — Snap Fitness Preston
  "629a27e9-11ab-4009-ae18-f53d7daea49f", // Benjamin Gunning — Snap Fitness Armadale
  "8d746236-9124-426d-90f7-959765978fbb", // Gavin Pereira — Snap Fitness Sunshine
  "90d96e4c-5c77-49d0-961f-c30ea2ccbc32", // Kosta Magdalinos — Snap Fitness Wantirna
  "99bbf8da-9baf-4df2-b1d9-37ddf5e3579a", // Ajit Singh — Snap Fitness Point Cook
]);

export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });

  const planId = req.nextUrl.searchParams.get("planId");
  if (!planId) {
    return NextResponse.json(
      { error: "Missing ?planId= query param" },
      { status: 400 },
    );
  }
  if (!RECOVERY_ALLOW_LIST.has(planId)) {
    return NextResponse.json(
      { error: "planId not in the recovery allow-list — refusing" },
      { status: 403 },
    );
  }

  const svc = createServiceRoleClient();
  const result = await activatePlan(svc, planId);
  return NextResponse.json({ result });
}
