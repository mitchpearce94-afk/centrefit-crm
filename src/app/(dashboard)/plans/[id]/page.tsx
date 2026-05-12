import { createClient } from '@/lib/supabase/server';
import { notFound } from 'next/navigation';
import PlanEditor from '@/components/plan-builder/PlanEditor';
import { PlanLoader } from './plan-loader';

export default async function EditPlanPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  // Fetch the plan's cfp_url
  const { data: plan } = await supabase
    .from('plan_files')
    .select('id, cfp_url')
    .eq('id', id)
    .single();

  if (!plan || !plan.cfp_url) notFound();

  // Fetch active jobs for the job selector
  const { data: jobs } = await supabase
    .from('jobs')
    .select('id, number, reference, customer:customers(id, name), site:customer_sites(id, name, address, suburb, postcode, state)')
    .order('number', { ascending: false })
    .limit(200);

  return (
    <PlanLoader planId={plan.id} cfpUrl={plan.cfp_url}>
      <PlanEditor jobs={jobs ?? []} />
    </PlanLoader>
  );
}
