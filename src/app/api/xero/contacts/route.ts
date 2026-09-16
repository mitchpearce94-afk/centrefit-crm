import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getAuthedClient } from "@/lib/xero/client";
import { getXeroContact, searchXeroContacts } from "@/lib/xero/contacts";
import { captureXeroRateLimit, isXeroRateLimited } from "@/lib/xero/rate-limit";

/**
 * GET /api/xero/contacts?q=<name>   — picker search (ACTIVE contacts, ≤12)
 * GET /api/xero/contacts?id=<guid>  — one contact (name/address for display)
 *
 * Billing-contact picker (docs/billing-contact-CONTEXT.md D3). Any active
 * staff member; read-only against Xero.
 */
export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const { data: staffRow } = await supabase.from("staff").select("is_active").eq("id", user.id).maybeSingle();
  if (!staffRow?.is_active) return NextResponse.json({ error: "Staff only" }, { status: 403 });

  const q = (req.nextUrl.searchParams.get("q") ?? "").trim();
  const id = (req.nextUrl.searchParams.get("id") ?? "").trim();
  if (!q && !id) return NextResponse.json({ contacts: [] });

  const limited = await isXeroRateLimited(supabase);
  if (limited) {
    return NextResponse.json({ error: "Xero quota exhausted — try again shortly", rateLimited: true }, { status: 429 });
  }
  try {
    const { client, conn } = await getAuthedClient();
    if (id) {
      const contact = await getXeroContact(client, conn.tenant_id, id);
      return NextResponse.json({ contact });
    }
    const contacts = await searchXeroContacts(client, conn.tenant_id, q);
    return NextResponse.json({ contacts });
  } catch (err: unknown) {
    await captureXeroRateLimit(supabase, err);
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: `Xero error: ${message}` }, { status: 502 });
  }
}
