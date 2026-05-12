import { createClient } from '@/lib/supabase/server';
import { notFound } from 'next/navigation';
import PlanEditor from '@/components/plan-builder/PlanEditor';
import { PlanLoader } from './plan-loader';

export default async function EditPlanPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  // Fetch the plan's cfp_url + its current job link (so we can keep that
  // job visible in the picker even though it's "already linked").
  const { data: plan } = await supabase
    .from('plan_files')
    .select('id, cfp_url, job_id')
    .eq('id', id)
    .single();

  if (!plan || !plan.cfp_url) notFound();

  // Exclude completion-phase statuses (Complete / Cancelled)
  const { data: completionStatuses } = await supabase
    .from('statuses')
    .select('id')
    .eq('phase', 'completion');
  const completionIds = (completionStatuses ?? []).map((s) => s.id);

  // Exclude jobs already linked to a different plan; the job linked to THIS
  // plan stays visible so we don't surprise the user mid-edit.
  const { data: linkedPlans } = await supabase
    .from('plan_files')
    .select('job_id')
    .not('job_id', 'is', null)
    .neq('id', plan.id);
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
  const jobs = (jobsRaw ?? []).filter(
    (j: { id: string }) => !linkedJobIds.has(j.id) || j.id === plan.job_id,
  );

  return (
    <PlanLoader planId={plan.id} cfpUrl={plan.cfp_url}>
      <PlanEditor jobs={jobs} />
    </PlanLoader>
  );
}
