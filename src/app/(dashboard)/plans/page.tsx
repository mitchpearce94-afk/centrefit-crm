import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { LoadPlanButton } from './load-plan-button';
import { OpenPlanButton } from './open-plan-button';
import { StateFolder } from './state-folder';

const AU_STATES = ['QLD', 'NSW', 'VIC', 'SA', 'WA', 'TAS', 'NT', 'ACT'];

export default async function PlansPage() {
  const supabase = await createClient();

  const { data: plans } = await supabase
    .from('plan_files')
    .select('id, name, client_name, site_name, state, revision, device_counts, cfp_url, pdf_url, created_at, updated_at, quote_id, job_id, sent_to_electrician_at, sent_to_electrician_email, job:jobs(id, number, status:statuses(id, name)), quote:quotes(id, job_id, job:jobs(id, number, status:statuses(id, name)))')
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

    // Prefer direct job link, fall back to quote → job chain
    const directJob = plan.job ? (Array.isArray(plan.job) ? plan.job[0] : plan.job) : null;
    const quote = Array.isArray(plan.quote) ? plan.quote[0] : plan.quote;
    const quoteJob = quote?.job ? (Array.isArray(quote.job) ? quote.job[0] : quote.job) : null;
    const job = directJob || quoteJob;
    const jobStatus = job?.status ? (Array.isArray(job.status) ? job.status[0] : job.status) : null;
    const isCompleted = jobStatus && completionIds.has(jobStatus.id);

    const enriched = { ...plan, _job: job, _isCompleted: isCompleted };
    if (isCompleted) {
      byState[state].completed.push(enriched);
    } else {
      byState[state].active.push(enriched);
    }
  }

  // States with active plans
  const activeStates = AU_STATES.filter(s => byState[s] && byState[s].active.length > 0);
  // States with completed plans
  const completedStates = AU_STATES.filter(s => byState[s] && byState[s].completed.length > 0);
  const totalCompleted = completedStates.reduce((sum, s) => sum + byState[s].completed.length, 0);
  const hasAnyPlans = activeStates.length > 0 || completedStates.length > 0;

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-foreground">Plans</h1>
      </div>

      {/* Quick actions */}
      <div className="bg-card border border-border rounded-lg p-6 mb-6">
        <div className="flex items-center justify-center gap-4">
          <LoadPlanButton label="Load .cfp" />
          <Link href="/plans/new?fresh=1" className="px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm font-medium hover:opacity-90 transition-opacity">
            New Plan
          </Link>
        </div>
      </div>

      {!hasAnyPlans ? (
        <div className="bg-card border border-border rounded-lg p-8 text-center">
          <p className="text-muted-foreground text-sm">
            No plans saved yet. Plans appear here when you save from the Plan Builder.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {/* Active plans by state */}
          {activeStates.map(state => (
            <StateFolder key={state} state={state} count={byState[state].active.length}>
              {byState[state].active.map((plan: any) => (
                <PlanRow key={plan.id} plan={plan} countDevices={countDevices} formatDate={formatDate} />
              ))}
            </StateFolder>
          ))}

          {/* Completed plans — separate section at the bottom */}
          {completedStates.length > 0 && (
            <StateFolder state="Completed" count={totalCompleted}>
              {completedStates.map(state => (
                <div key={state}>
                  <div className="px-4 py-2 border-b border-border bg-accent/20">
                    <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{state}</span>
                  </div>
                  {byState[state].completed.map((plan: any) => (
                    <PlanRow key={plan.id} plan={plan} countDevices={countDevices} formatDate={formatDate} completed />
                  ))}
                </div>
              ))}
            </StateFolder>
          )}
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
          {plan.sent_to_electrician_at && (
            <span
              title={`Sent to ${plan.sent_to_electrician_email ?? "electrician"} on ${formatDate(plan.sent_to_electrician_at)}`}
              className="flex-shrink-0 inline-flex items-center gap-1 px-1.5 py-0.5 bg-cyan-500/10 text-cyan-400 rounded text-[10px] font-medium uppercase tracking-wide"
            >
              <svg className="h-2.5 w-2.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                <path d="M22 2L11 13" /><path d="M22 2l-7 20-4-9-9-4 20-7z" />
              </svg>
              Sent to electrician
            </span>
          )}
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
        {plan.pdf_url && (() => {
          const pdfName = [plan.state, plan.client_name, plan.site_name, plan.revision ? 'Rev ' + plan.revision : null].filter(Boolean).join(' - ').replace(/[^a-zA-Z0-9\-_ ]/g, '') + '.pdf';
          return (
            <a href={plan.pdf_url + '?t=' + new Date(plan.updated_at || plan.created_at).getTime()} download={pdfName}
              className="px-2.5 py-1.5 bg-green-600/10 text-green-500 hover:bg-green-600/20 rounded text-xs font-medium transition-colors">
              PDF
            </a>
          );
        })()}
        {plan.cfp_url && (
          <a href={plan.cfp_url} download className="px-2.5 py-1.5 bg-accent text-muted-foreground hover:text-foreground rounded text-xs transition-colors">
            .cfp
          </a>
        )}
      </div>
    </div>
  );
}
