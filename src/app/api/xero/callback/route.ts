import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { buildXeroClient } from "@/lib/xero/client";

/**
 * Xero OAuth callback. Exchanges the authorization code for tokens, fetches
 * the connected tenant, and stores the connection row.
 */
export async function GET(req: NextRequest) {
  const appUrl =
    process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") ?? "http://localhost:3000";

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.redirect(`${appUrl}/login`);
  }

  try {
    const client = buildXeroClient();
    const tokenSet = await client.apiCallback(req.url);
    await client.updateTenants(false);

    const tenants = client.tenants;
    if (!tenants || tenants.length === 0) {
      return NextResponse.redirect(
        `${appUrl}/settings/integrations?error=no_tenants`
      );
    }
    const tenant = tenants[0];

    const expiresAt = tokenSet.expires_at
      ? new Date(tokenSet.expires_at * 1000).toISOString()
      : new Date(Date.now() + 1800 * 1000).toISOString();

    // Look up staff row for connected_by
    const { data: staff } = await supabase
      .from("staff")
      .select("id")
      .eq("user_id", user.id)
      .maybeSingle();

    // Upsert by tenant_id so reconnecting the same org just refreshes tokens
    const { error: upsertErr } = await supabase
      .from("xero_connections")
      .upsert(
        {
          tenant_id: tenant.tenantId,
          tenant_name: tenant.tenantName ?? null,
          tenant_type: tenant.tenantType ?? null,
          access_token: tokenSet.access_token ?? "",
          refresh_token: tokenSet.refresh_token ?? "",
          id_token: tokenSet.id_token ?? null,
          expires_at: expiresAt,
          scopes: tokenSet.scope ?? null,
          connected_by: staff?.id ?? null,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "tenant_id" }
      );

    if (upsertErr) {
      return NextResponse.redirect(
        `${appUrl}/settings/integrations?error=${encodeURIComponent(upsertErr.message)}`
      );
    }

    return NextResponse.redirect(`${appUrl}/settings/integrations?connected=1`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.redirect(
      `${appUrl}/settings/integrations?error=${encodeURIComponent(msg)}`
    );
  }
}
