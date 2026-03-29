import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { autoTransitionJobStatusServer } from "@/lib/job-status-transitions";

export async function POST(req: NextRequest) {
  const { token, action } = await req.json();
  if (!token || !["accept", "decline"].includes(action)) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const cookieStore = await cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { getAll: () => cookieStore.getAll() } }
  );

  const { data: quote, error } = await supabase
    .from("quotes")
    .select("id, status, ref, job_id")
    .eq("response_token", token)
    .single();

  if (error || !quote) {
    return NextResponse.json({ error: "Quote not found or link expired" }, { status: 404 });
  }

  if (quote.status !== "sent") {
    return NextResponse.json({ error: `Quote has already been ${quote.status}` }, { status: 400 });
  }

  const newStatus = action === "accept" ? "accepted" : "declined";
  const update: Record<string, unknown> = {
    status: newStatus,
    [`${newStatus}_at`]: new Date().toISOString(),
  };

  await supabase.from("quotes").update(update).eq("id", quote.id);

  // Auto-transition linked job
  if (quote.job_id) {
    const jobAction = action === "accept" ? "quote_accepted" : "quote_declined";
    await autoTransitionJobStatusServer(quote.job_id, jobAction, supabase);
  }

  return NextResponse.json({ success: true, status: newStatus, ref: quote.ref });
}
