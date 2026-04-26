import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { tryCreatePP2ForJob } from "@/lib/invoices/auto-pp2";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!id) {
    return NextResponse.json({ error: "Job id required" }, { status: 400 });
  }

  const supabase = await createClient();
  const result = await tryCreatePP2ForJob(supabase, id);

  return NextResponse.json(result);
}
