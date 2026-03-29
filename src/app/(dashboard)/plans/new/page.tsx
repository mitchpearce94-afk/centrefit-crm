import { createClient } from '@/lib/supabase/server';
import PlanEditor from '@/components/plan-builder/PlanEditor';

export default async function NewPlanPage() {
  const supabase = await createClient();

  // Fetch active jobs for the job selector
  const { data: jobs } = await supabase
    .from('jobs')
    .select('id, number, reference, customer:customers(id, name)')
    .order('number', { ascending: false })
    .limit(200);

  return <PlanEditor jobs={jobs ?? []} />;
}
