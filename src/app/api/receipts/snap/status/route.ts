import { NextRequest, NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { resolveSnapStaff } from "@/lib/receipts/snap-device";
import { snapStatusOf } from "@/lib/receipts/snap";

/**
 * GET /api/receipts/snap/status?ids=a,b,c — what happened to the phone's
 * uploads after the shutter: still processing, forwarded to Xero (with the
 * vendor/amount we read), or failed (with the reason). Only the caller's own
 * uploads are returned. Polled by the Snap app for ~2 minutes per receipt.
 */
export async function GET(req: NextRequest) {
  const auth = await resolveSnapStaff();
  if (!auth) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const ids = (req.nextUrl.searchParams.get("ids") ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => /^[0-9a-f-]{36}$/i.test(s))
    .slice(0, 40);
  if (ids.length === 0) return NextResponse.json({ statuses: [] });
  const svc = createServiceRoleClient();
  const { data, error } = await svc
    .from("receipts")
    .select("id, email_sent, email_error, forwarded_to, vendor, amount")
    .in("id", ids)
    .eq("uploaded_by", auth.staff.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ statuses: (data ?? []).map(snapStatusOf) }, { headers: { "Cache-Control": "no-store" } });
}
