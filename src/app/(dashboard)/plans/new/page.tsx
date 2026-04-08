import { createClient } from '@/lib/supabase/server';
import PlanEditor from '@/components/plan-builder/PlanEditor';
import { PlanStoreInit } from './plan-store-init';

export default async function NewPlanPage({ searchParams }: { searchParams: Promise<{ fresh?: string }> }) {
  const params = await searchParams;
  const supabase = await createClient();

  // Fetch active jobs for the job selector
  const { data: jobs } = await supabase
    .from('jobs')
    .select('id, number, reference, customer:customers(id, name)')
    .order('number', { ascending: false })
    .limit(200);

  return params.fresh ? (
    <PlanStoreInit>
      <PlanEditor jobs={jobs ?? []} />
    </PlanStoreInit>
  ) : (
    <PlanEditor jobs={jobs ?? []} />
  );
}
