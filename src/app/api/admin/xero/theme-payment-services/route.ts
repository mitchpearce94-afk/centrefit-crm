import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { getAuthedClient } from "@/lib/xero/client";

/**
 * Read-only inspector for what payment services are attached to a Xero
 * branding theme. Helps determine why "Pay Now" links appear on invoices
 * using the theme.
 *
 * Query params:
 *   ?themeId=  GUID of the branding theme to inspect. Defaults to the
 *              Solutions DD theme env var.
 *
 * Auth-gated. One Xero API call. No mutation.
 */
export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });

  const themeId =
    req.nextUrl.searchParams.get("themeId") ??
    process.env.XERO_BRANDING_THEME_SOLUTIONS_DD_ID ??
    "";
  if (!themeId) {
    return NextResponse.json(
      { error: "No theme ID supplied and no env var fallback" },
      { status: 400 },
    );
  }

  try {
    const svc = createServiceRoleClient();
    const { client: xero, conn } = await getAuthedClient(svc);
    const res = await xero.accountingApi.getBrandingThemePaymentServices(
      conn.tenant_id,
      themeId,
    );
    const services = res.body.paymentServices ?? [];
    return NextResponse.json({
      themeId,
      count: services.length,
      services: services.map((s) => ({
        id: s.paymentServiceID,
        name: s.paymentServiceName,
        type: s.paymentServiceType,
        url: s.paymentServiceUrl,
      })),
    });
  } catch (err) {
    // Surface the actual error so we can diagnose. xero-node throws plain
    // objects with response/body — stringify to capture everything.
    const errStr = err instanceof Error ? err.message : (() => {
      try { return JSON.stringify(err); } catch { return String(err); }
    })();
    return NextResponse.json(
      { error: "Xero call failed", detail: errStr.slice(0, 4000) },
      { status: 500 },
    );
  }
}
