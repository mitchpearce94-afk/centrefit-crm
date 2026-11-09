import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isSiteChecklistKind, SITE_CHECKLISTS, type SiteChecklistTicks } from "@/lib/site-checklists";

/**
 * POST /api/sites/[id]/checklists/[kind] — tick or untick one item on a site
 * checklist (alarm panel testing). Body: { itemKey, done: boolean, jobId?, notes? }.
 * Creates the site_checklists row on first tick; stamps completed_at when
 * every item is ticked and clears it when one is unticked. RLS
 * (jobs.update_status) applies, same as the job progress ticks.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string; kind: string }> }) {
  const { id: siteId, kind } = await params;
  if (!isSiteChecklistKind(kind)) return NextResponse.json({ error: "Unknown checklist" }, { status: 400 });
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const template = SITE_CHECKLISTS[kind];
  const itemKey = typeof body?.itemKey === "string" ? body.itemKey : null;
  const notes = typeof body?.notes === "string" ? body.notes.trim().slice(0, 2000) : undefined;
  if (itemKey && !template.items.some((i) => i.key === itemKey)) return NextResponse.json({ error: "Unknown item" }, { status: 400 });

  const { data: existing } = await supabase.from("site_checklists").select("id, ticks, job_id").eq("site_id", siteId).eq("kind", kind).maybeSingle();
  const ticks: SiteChecklistTicks = { ...((existing?.ticks as SiteChecklistTicks | null) ?? {}) };

  if (itemKey) {
    if (body?.done) {
      const { data: staffRow } = await supabase.from("staff").select("initials").eq("id", user.id).maybeSingle();
      const today = new Date().toLocaleDateString("en-AU", { day: "2-digit", month: "2-digit", year: "2-digit", timeZone: "Australia/Brisbane" });
      ticks[itemKey] = { at: new Date().toISOString(), by: `${staffRow?.initials ?? "??"} ${today}` };
    } else {
      delete ticks[itemKey];
    }
  }
  const allDone = template.items.every((i) => ticks[i.key]);
  const row = {
    site_id: siteId,
    kind,
    ticks,
    job_id: typeof body?.jobId === "string" && body.jobId ? body.jobId : (existing?.job_id as string | null) ?? null,
    completed_at: allDone ? new Date().toISOString() : null,
    ...(notes !== undefined ? { notes } : {}),
    ...(existing ? {} : { created_by: user.id }),
  };
  const { error } = await supabase.from("site_checklists").upsert(row, { onConflict: "site_id,kind" });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, ticks, completed: allDone, done: template.items.filter((i) => ticks[i.key]).length, total: template.items.length });
}
