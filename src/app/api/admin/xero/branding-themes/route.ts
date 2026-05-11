import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { getAuthedClient } from "@/lib/xero/client";

/**
 * Read-only: list all Branding Themes configured in the Xero org so Mitchell
 * can grab the GUIDs to set as XERO_BRANDING_THEME_COMMUNICATIONS_DD_ID and
 * XERO_BRANDING_THEME_SOLUTIONS_DD_ID env vars.
 *
 * Just visit /api/admin/xero/branding-themes in the browser address bar
 * (no console paste needed). Returns a small JSON object.
 *
 * Auth-gated. One Xero API call. No mutation.
 */
export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });

  const svc = createServiceRoleClient();
  const { client: xero, conn } = await getAuthedClient(svc);
  const res = await xero.accountingApi.getBrandingThemes(conn.tenant_id);
  const themes = (res.body.brandingThemes ?? []).map((t) => ({
    id: t.brandingThemeID,
    name: t.name,
    sortOrder: t.sortOrder,
  }));
  return NextResponse.json({ count: themes.length, themes });
}
