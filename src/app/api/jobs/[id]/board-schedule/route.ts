import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * Persist a job's status-board fields (new-build flag, rough-in/fit-off date
 * ranges + crew) AND materialise the crew bookings onto the scheduler.
 *
 * Scheduler entries tagged board_phase are treated as derived: every call wipes
 * this job's existing rough_in/fit_off entries and rebuilds them from the
 * current state — one all-day, multi-day entry per crew member. Toggling the
 * job off the board (isNewBuild=false) clears them.
 */
interface Body {
  isNewBuild?: boolean;
  roughInDate?: string | null;
  roughInEndDate?: string | null;
  roughInStaffIds?: string[];
  fitOffDate?: string | null;
  fitOffEndDate?: string | null;
  fitOffStaffIds?: string[];
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  let body: Body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const ids = (v: unknown): string[] =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  const roughStaff = ids(body.roughInStaffIds);
  const fitStaff = ids(body.fitOffStaffIds);
  const isNewBuild = !!body.isNewBuild;

  // 1. Persist the board fields on the job.
  const { error: updErr } = await supabase
    .from("jobs")
    .update({
      is_new_build: isNewBuild,
      rough_in_date: body.roughInDate || null,
      rough_in_end_date: body.roughInEndDate || null,
      rough_in_staff_ids: roughStaff,
      fit_off_date: body.fitOffDate || null,
      fit_off_end_date: body.fitOffEndDate || null,
      fit_off_staff_ids: fitStaff,
    })
    .eq("id", id);
  if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 });

  // 2. Wipe this job's existing auto-created board bookings.
  const { error: delErr } = await supabase
    .from("schedule_entries")
    .delete()
    .eq("job_id", id)
    .in("board_phase", ["rough_in", "fit_off"]);
  if (delErr) return NextResponse.json({ error: delErr.message }, { status: 500 });

  // 3. Rebuild from current state (skip entirely if no longer a new build).
  const rows: Record<string, unknown>[] = [];
  const addPhase = (
    phase: "rough_in" | "fit_off",
    start: string | null | undefined,
    end: string | null | undefined,
    staffIds: string[],
    label: string,
  ) => {
    if (!start || staffIds.length === 0) return;
    const endDate = end && end > start ? end : null; // YYYY-MM-DD compares lexically
    for (const staffId of staffIds) {
      rows.push({
        entry_type: "job",
        job_id: id,
        staff_id: staffId,
        schedule_date: start,
        end_date: endDate,
        start_time: null,
        end_time: null,
        notes: label,
        board_phase: phase,
        created_by: user.id,
      });
    }
  };

  if (isNewBuild) {
    addPhase("rough_in", body.roughInDate, body.roughInEndDate, roughStaff, "Rough In");
    addPhase("fit_off", body.fitOffDate, body.fitOffEndDate, fitStaff, "Fit Off");
  }

  let scheduled = 0;
  if (rows.length > 0) {
    const { data, error: insErr } = await supabase
      .from("schedule_entries")
      .insert(rows)
      .select("id");
    if (insErr) return NextResponse.json({ error: insErr.message }, { status: 500 });
    scheduled = data?.length ?? 0;
  }

  return NextResponse.json({ ok: true, scheduled });
}
