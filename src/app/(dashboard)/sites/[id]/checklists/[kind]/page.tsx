import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isSiteChecklistKind, SITE_CHECKLISTS, type SiteChecklistTicks } from "@/lib/site-checklists";
import { SiteChecklistView } from "./checklist-view";

export const dynamic = "force-dynamic";

/** Site → Documentation → a checklist (alarm panel testing). Linked from the job's Progress tab. */
export default async function SiteChecklistPage({ params }: { params: Promise<{ id: string; kind: string }> }) {
  const { id, kind } = await params;
  if (!isSiteChecklistKind(kind)) notFound();
  const supabase = await createClient();
  const [{ data: site }, { data: row }, { data: jobs }] = await Promise.all([
    supabase.from("customer_sites").select("id, name").eq("id", id).maybeSingle(),
    supabase.from("site_checklists").select("ticks, notes, completed_at, job_id").eq("site_id", id).eq("kind", kind).maybeSingle(),
    supabase.from("jobs").select("id, number, reference, status:statuses(phase)").eq("site_id", id).order("created_at", { ascending: false }).limit(10),
  ]);
  if (!site) notFound();
  const openJobs = ((jobs ?? []) as Array<{ id: string; number: string; reference: string | null; status: { phase: string | null } | { phase: string | null }[] | null }>)
    .filter((j) => { const st = Array.isArray(j.status) ? j.status[0] : j.status; return st?.phase !== "completion"; })
    .map((j) => ({ id: j.id, number: j.number, reference: j.reference }));
  return (
    <SiteChecklistView
      siteId={site.id}
      siteName={site.name}
      template={SITE_CHECKLISTS[kind]}
      initialTicks={((row?.ticks as SiteChecklistTicks | null) ?? {})}
      initialNotes={(row?.notes as string | null) ?? null}
      completedAt={(row?.completed_at as string | null) ?? null}
      jobs={openJobs}
      linkedJobId={(row?.job_id as string | null) ?? null}
    />
  );
}
