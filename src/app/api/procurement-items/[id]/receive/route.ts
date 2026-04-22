import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * Mark a procurement item as received. Stamps received_at + received_by
 * so we have accountability on who signed off on stock arriving.
 *
 * Only valid when current status is 'ordered' — you can't receive items
 * that were never ordered through Xero (IN STOCK items should be flipped
 * via the update endpoint, not this one).
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  // Resolve the staff row by email (staff table has no user_id link, only email)
  const { data: staff } = await supabase
    .from("staff")
    .select("id")
    .eq("email", user.email ?? "")
    .maybeSingle();

  const { data: current } = await supabase
    .from("job_procurement_items")
    .select("status")
    .eq("id", id)
    .maybeSingle();
  if (!current) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (current.status !== "ordered") {
    return NextResponse.json(
      { error: `Can only receive an 'ordered' item (currently ${current.status})` },
      { status: 400 },
    );
  }

  const { data: updated, error } = await supabase
    .from("job_procurement_items")
    .update({
      status: "received",
      received_at: new Date().toISOString(),
      received_by: staff?.id ?? null,
    })
    .eq("id", id)
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ item: updated });
}
