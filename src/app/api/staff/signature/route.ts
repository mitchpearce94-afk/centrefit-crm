import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service";

/**
 * Self-serve staff signature capture (Phase C — SWMS sign-on register).
 * Staff RLS is admin-only on UPDATE, so a client-side save silently no-ops;
 * this route authenticates the caller then writes their OWN row with the
 * service client (same pattern as other self-edit flows).
 */
export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  let body: { signature?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
  const { signature } = body;
  if (!signature?.startsWith("data:image/png;base64,") || signature.length > 500_000) {
    return NextResponse.json({ error: "A valid signature image is required" }, { status: 400 });
  }

  const sb = createServiceRoleClient();
  const { error } = await sb
    .from("staff")
    .update({ signature_data: signature, signature_updated_at: new Date().toISOString() })
    .eq("id", user.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ success: true });
}
