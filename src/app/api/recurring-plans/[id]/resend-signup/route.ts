import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { resendSignupEmail } from "@/lib/recurring/resend-signup";

/**
 * Staff-triggered resend of the mandate signup email for a pending plan.
 * Mints a fresh GoCardless flow link (the old one expires ~7 days) and
 * emails the customer's primary contact. CUSTOMER-FACING EMAIL — only ever
 * fired from the explicit button on the plan page.
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: planId } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  try {
    const svc = createServiceRoleClient();
    const result = await resendSignupEmail(svc, planId, { reminder: false });
    return NextResponse.json({ ok: true, to: result.to });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Resend failed" },
      { status: 400 },
    );
  }
}
