import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * POST /api/receipts/mark-invoiced — flag receipts as added to an invoice so
 * they stop appearing as pending lines on the job's invoice builder.
 * Body: { ids: string[] }.
 */
export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const ids = Array.isArray(body?.ids) ? body.ids.filter((v: unknown): v is string => typeof v === "string") : [];
  if (ids.length === 0) return NextResponse.json({ ok: true, updated: 0 });

  const { error } = await supabase
    .from("receipts")
    .update({ added_to_invoice: true, updated_at: new Date().toISOString() })
    .in("id", ids);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true, updated: ids.length });
}
