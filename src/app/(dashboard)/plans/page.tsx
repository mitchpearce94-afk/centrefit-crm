import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { LoadPlanButton } from './load-plan-button';
import { OpenPlanButton } from './open-plan-button';

const AU_STATES = ['QLD', 'NSW', 'VIC', 'SA', 'WA', 'TAS', 'NT', 'ACT'];

export default async function PlansPage() {
  const supabase = await createClient();

  const { data: plans } = await supabase
    .from('plan_files')
    .select('id, name, client_name, site_name, state, revision, device_counts, cfp_url, pdf_url, created_at, updated_at, quote_id, quote:quotes(id, job_id, job:jobs(id, number, status:statuses(id, name)))')
    .order('updated_at', { ascending: false });

  const allPlans = plans ?? [];

  // Fetch completion status IDs to determine active vs completed
  const { data: completionStatuses } = await supabase
    .from('statuses')
    .select('id, name')
    .in('name', ['Complete', 'Cancelled', 'Invoice Sent', 'Closed']);
  const completionIds = new Set((completionStatuses ?? []).map((s: any) => s.id));

  function countDevices(dc: any): number {
    if (!dc || typeof dc !== 'object') return 0;
    return Object.values(dc).reduce((sum: number, v) => sum + (typeof v === 'number' ? v : 0), 0);
  }

  function formatDate(d: string): string {
    return new Date(d).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' });
  }

  // Group plans by state
  const byState: Record<string, { active: any[]; completed: any[] }> = {};

  for (const plan of allPlans) {
    const state = plan.state || 'QLD';
    if (!byState[state]) byState[state] = { active: [], completed: [] };

    const quote = Array.isArray(plan.quote) ? plan.quote[0] : plan.quote;
    const job = quote?.job ? (Array.isArray(quote.job) ? quote.job[0] : quote.job) : null;
    const jobStatus = job?.status ? (Array.isArray(job.status) ? job.status[0] : job.status) : null;
    const isCompleted = jobStatus && completionIds.has(jobStatus.id);

    const enriched = { ...plan, _job: job, _isCompleted: isCompleted };
    if (isCompleted) {
      byState[state].completed.push(enriched);
    } else {
      byState[state].active.push(enriched);
    }
  }

  // Only show states that have plans
  const activeStates = AU_STATES.filter(s => byState[s]);

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold text-foreground">Plans</h1>
        <div className="flex items-center gap-2">
          <LoadPlanButton />
          <Link href="/plans/new" className="px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm font-medium hover:opacity-90 transition-opacity">
            New Plan
          </Link>
        </div>
      </div>

      {activeStates.length === 0 ? (
        <div className="bg-card border border-border rounded-lg p-8 text-center">
          <div className="text-4xl mb-3">📐</div>
          <h2 className="text-lg font-semibold text-foreground mb-1">No Plans Yet</h2>
          <p className="text-muted-foreground text-sm mb-4">
            Plans appear here when you save from the Plan Builder. Organised by state.
          </p>
          <div className="flex items-center justify-center gap-3">
            <LoadPlanButton label="Load Existing (.cfp)" />
            <Link href="/plans/new" className="px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm font-medium hover:opacity-90 transition-opacity">
              Create New Plan
            </Link>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          {activeStates.map(state => {
            const { active, completed } = byState[state];
            return (
              <div key={state} className="bg-card border border-border rounded-lg overflow-hidden">
                {/* State header */}
                <div className="px-4 py-3 border-b border-border bg-accent/30">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-bold text-foreground">{state}</span>
                    <span className="text-xs text-muted-foreground">{active.length + completed.length} plan{active.length + completed.length !== 1 ? 's' : ''}</span>
                  </div>
                </div>

                {/* Active plans */}
                {active.length > 0 && (
                  <div>
                    <div className="px-4 py-2 border-b border-border">
                      <span className="text-xs font-medium text-emerald-500 uppercase tracking-wider">Active</span>
                    </div>
                    {active.map((plan: any) => (
                      <PlanRow key={plan.id} plan={plan} countDevices={countDevices} formatDate={formatDate} />
                    ))}
                  </div>
                )}

                {/* Completed plans */}
                {completed.length > 0 && (
                  <div>
                    <div className="px-4 py-2 border-b border-border">
                      <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Completed</span>
                    </div>
                    {completed.map((plan: any) => (
                      <PlanRow key={plan.id} plan={plan} countDevices={countDevices} formatDate={formatDate} completed />
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function PlanRow({ plan, countDevices, formatDate, completed }: { plan: any; countDevices: (dc: any) => number; formatDate: (d: string) => string; completed?: boolean }) {
  const devices = countDevices(plan.device_counts);
  const job = plan._job;

  return (
    <div className={`flex items-center gap-4 px-4 py-3 border-b border-border last:border-b-0 hover:bg-accent/30 transition-colors ${completed ? 'opacity-60' : ''}`}>
      {/* Plan info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-medium text-sm text-foreground truncate">{[plan.client_name, plan.site_name].filter(Boolean).join(' — ') || plan.name}</span>
          <span className="flex-shrink-0 px-1.5 py-0.5 bg-amber-500/10 text-amber-500 rounded text-xs font-medium">Rev {plan.revision || 'A'}</span>
        </div>
        <div className="flex items-center gap-3 mt-0.5 text-xs text-muted-foreground">
          <span>{formatDate(plan.updated_at || plan.created_at)}</span>
          {job && (
            <Link href={`/jobs/${job.id}`} className="text-primary hover:underline">{job.number}</Link>
          )}
        </div>
      </div>

      {/* Device count */}
      <div className="flex-shrink-0">
        <span className="inline-flex items-center justify-center min-w-7 px-1.5 py-0.5 bg-primary/10 text-primary rounded text-xs font-medium">
          {devices}
        </span>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-1.5 flex-shrink-0">
        {plan.cfp_url && (
          <OpenPlanButton cfpUrl={plan.cfp_url} planId={plan.id} />
        )}
        {plan.pdf_url && (
          <a href={plan.pdf_url + '?t=' + new Date(plan.updated_at || plan.created_at).getTime()} target="_blank" rel="noopener noreferrer" download
            className="px-2.5 py-1.5 bg-green-600/10 text-green-500 hover:bg-green-600/20 rounded text-xs font-medium transition-colors">
            PDF
          </a>
        )}
        {plan.cfp_url && (
          <a href={plan.cfp_url} download className="px-2.5 py-1.5 bg-accent text-muted-foreground hover:text-foreground rounded text-xs transition-colors">
            .cfp
          </a>
        )}
      </div>
    </div>
  );
}
