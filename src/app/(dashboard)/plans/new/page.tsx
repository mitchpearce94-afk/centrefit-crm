import { createClient } from '@/lib/supabase/server';
import PlanEditor from '@/components/plan-builder/PlanEditor';
import { PlanStoreInit } from './plan-store-init';

export default async function NewPlanPage({ searchParams }: { searchParams: Promise<{ fresh?: string }> }) {
  const params = await searchParams;
  const supabase = await createClient();

  // Pull completion-phase statuses (Complete / Cancelled / etc.) to exclude
  // from the picker — finished jobs shouldn't be link targets for a new plan.
  const { data: completionStatuses } = await supabase
    .from('statuses')
    .select('id')
    .eq('phase', 'completion');
  const completionIds = (completionStatuses ?? []).map((s) => s.id);

  // Jobs that already have a plan linked to them — exclude these too so we
  // don't see the same job offered for multiple plans. (New plan has no
  // self-id, so no exception is needed here; the edit page handles that.)
  const { data: linkedPlans } = await supabase
    .from('plan_files')
    .select('job_id')
    .not('job_id', 'is', null);
  const linkedJobIds = new Set(
    (linkedPlans ?? []).map((p: { job_id: string | null }) => p.job_id).filter(Boolean) as string[],
  );

  let jobsQuery = supabase
    .from('jobs')
    .select('id, number, reference, customer:customers(id, name), site:customer_sites(id, name, address, suburb, postcode, state)')
    .order('number', { ascending: false })
    .limit(400);

  if (completionIds.length > 0) {
    jobsQuery = jobsQuery.not('status_id', 'in', `(${completionIds.join(',')})`);
  }

  const { data: jobsRaw } = await jobsQuery;
  const jobs = (jobsRaw ?? []).filter((j: { id: string }) => !linkedJobIds.has(j.id));

  return params.fresh ? (
    <PlanStoreInit>
      <PlanEditor jobs={jobs} />
    </PlanStoreInit>
  ) : (
    <PlanEditor jobs={jobs} />
  );
}
