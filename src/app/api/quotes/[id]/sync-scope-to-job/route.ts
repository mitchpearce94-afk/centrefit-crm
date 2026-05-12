import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { syncQuoteScopeToJob } from "@/lib/quotes/sync-job-scope";

/**
 * One-shot endpoint to push the current Scope of Works + payment terms
 * into the linked job's description. Same logic the send + respond
 * routes use, exposed for manual backfill via the quote kebab menu.
 * Handy for quotes that were sent BEFORE the auto-sync existed.
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: quote } = await supabase
    .from("quotes")
    .select("id, job_id, ref")
    .eq("id", id)
    .single();

  if (!quote) {
    return NextResponse.json({ error: "Quote not found" }, { status: 404 });
  }
  if (!quote.job_id) {
    return NextResponse.json(
      { error: "Quote has no linked job. Link a job first then retry." },
      { status: 400 },
    );
  }

  try {
    await syncQuoteScopeToJob(supabase, quote.id);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Sync failed" },
      { status: 500 },
    );
  }

  return NextResponse.json({ success: true, ref: quote.ref, jobId: quote.job_id });
}
