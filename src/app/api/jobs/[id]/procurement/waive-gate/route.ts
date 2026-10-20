import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * Waive (POST) or clear (DELETE) the procurement payment gate on one job.
 *
 * The gate (lib/procurement/payment-gate.ts) is a money guard, so only
 * Mitchell can lift it — same owner check as the Finance tab. The waiver is
 * stamped with who/when/why so it reads back on the job's Procurement tab.
 *
 * POST body: { note?: string }
 */
const OWNER_EMAIL = "mitchell@centrefit.com.au";

async function owner() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { supabase, user: null, error: NextResponse.json({ error: "Not authenticated" }, { status: 401 }) };
  if (user.email?.toLowerCase() !== OWNER_EMAIL) {
    return { supabase, user: null, error: NextResponse.json({ error: "Only Mitchell can waive the payment gate" }, { status: 403 }) };
  }
  return { supabase, user, error: null };
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: jobId } = await params;
  const { supabase, user, error } = await owner();
  if (error || !user) return error;

  let note: string | null = null;
  try {
    const body = (await req.json()) as { note?: string };
    note = body.note?.trim() || null;
  } catch {
    /* no body is fine */
  }

  const { data, error: updErr } = await supabase
    .from("jobs")
    .update({
      procurement_gate_waived_at: new Date().toISOString(),
      procurement_gate_waived_by: user.id,
      procurement_gate_waiver_note: note,
    })
    .eq("id", jobId)
    .select("id, procurement_gate_waived_at");
  if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 });
  if (!data || data.length === 0) return NextResponse.json({ error: "Job not found" }, { status: 404 });

  return NextResponse.json({ ok: true, waivedAt: data[0].procurement_gate_waived_at });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id: jobId } = await params;
  const { supabase, user, error } = await owner();
  if (error || !user) return error;

  const { data, error: updErr } = await supabase
    .from("jobs")
    .update({
      procurement_gate_waived_at: null,
      procurement_gate_waived_by: null,
      procurement_gate_waiver_note: null,
    })
    .eq("id", jobId)
    .select("id");
  if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 });
  if (!data || data.length === 0) return NextResponse.json({ error: "Job not found" }, { status: 404 });

  return NextResponse.json({ ok: true });
}
