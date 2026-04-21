import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { buildXeroClient } from "@/lib/xero/client";

/**
 * Kick off the Xero OAuth flow. Requires the user to be authenticated and an
 * admin (enforced via RLS on xero_connections and a role check below).
 */
export async function GET(_req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.redirect(new URL("/login", process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"));
  }

  try {
    const client = buildXeroClient();
    const consentUrl = await client.buildConsentUrl();
    return NextResponse.redirect(consentUrl);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
