import { createClient } from '@/lib/supabase/client';

/**
 * Centralised job status auto-transition rules.
 * Each action defines which statuses it can transition FROM, and what it transitions TO.
 * If the job's current status isn't in the 'from' list, no transition happens.
 */
const AUTO_TRANSITIONS: Record<string, { from: string[]; to: string }> = {
  // Plans-to-electrician can fire at any non-completion stage. Sometimes
  // a draft quote already exists when we need to chase the sparky (a
  // revision, swapping electrician, getting a 2nd quote). Excludes only
  // final-completion statuses where the job's already physically wrapped.
  plans_sent_to_electrician: {
    from: [
      'Lead / Unassigned', 'Assigned',
      'Design Phase', 'Plans sent to electrician', 'Awaiting Approval', 'Sub-Quote Needed',
      'Quote Draft', 'Quote Sent', 'Quote Expired',
      'Awaiting Invoice Payment', 'Pending Schedule', 'Scheduled',
      'Follow Up', 'On Hold', 'Parts Dispatched', 'Parts Needed', 'Pending Tech',
    ],
    to: 'Plans sent to electrician',
  },

  // Quote lifecycle — each step includes earlier statuses so transitions
  // still fire even if a previous step in the chain was skipped
  quote_created: {
    from: ['Lead / Unassigned', 'Assigned', 'Pending Schedule', 'Scheduled', 'Follow Up', 'On Hold', 'Design Phase', 'Plans sent to electrician', 'Awaiting Approval'],
    to: 'Quote Draft',
  },
  quote_sent: {
    from: ['Quote Draft', 'Sub-Quote Needed', 'Lead / Unassigned', 'Assigned', 'Pending Schedule', 'Scheduled', 'Follow Up', 'On Hold', 'Design Phase', 'Plans sent to electrician', 'Awaiting Approval'],
    to: 'Quote Sent',
  },
  quote_accepted: {
    from: ['Quote Draft', 'Quote Sent', 'Quote Expired', 'Sub-Quote Needed', 'Lead / Unassigned', 'Assigned', 'Pending Schedule', 'Scheduled', 'Follow Up', 'On Hold', 'Design Phase', 'Plans sent to electrician', 'Awaiting Approval'],
    to: 'Pending Schedule',
  },
  quote_declined: {
    from: ['Quote Draft', 'Quote Sent', 'Quote Expired', 'Sub-Quote Needed', 'Lead / Unassigned', 'Assigned', 'Pending Schedule', 'Scheduled', 'Design Phase', 'Plans sent to electrician', 'Awaiting Approval'],
    to: 'Follow Up',
  },

  // Job lifecycle
  staff_assigned: {
    from: ['Lead / Unassigned'],
    to: 'Assigned',
  },
  job_scheduled: {
    from: ['Lead / Unassigned', 'Assigned', 'Pending Schedule', 'Follow Up'],
    to: 'Scheduled',
  },
  work_started: {
    from: ['Scheduled', 'Assigned', 'Pending Schedule', 'Quote Draft', 'Quote Sent', 'Quote Expired'],
    to: 'In Progress',
  },
  job_completed: {
    from: [
      'In Progress', 'Rough In', 'Fit Off', 'Equipment Build',
      'IT Service Active', 'NBN Active', 'Design Phase', 'Awaiting Approval',
      'Scheduled', 'Assigned', 'Pending Schedule',
      'Follow Up', 'On Hold', 'Parts Dispatched', 'Parts Needed', 'Pending Tech',
    ],
    to: 'Ready to Invoice',
  },
  invoice_sent: {
    from: ['Ready to Invoice'],
    to: 'Invoice Sent',
  },
  payment_received: {
    from: ['Invoice Sent'],
    to: 'Complete',
  },

  // PP1 / "full on acceptance" flow: authorising the invoice (not the final
  // PP2 one) parks the job in "Awaiting Invoice Payment" until Xero confirms
  // payment via webhook. Payment then bumps the job back to "Pending Schedule"
  // so it can be put on the calendar.
  invoice_authorised: {
    from: ['Pending Schedule', 'Quote Sent', 'Quote Draft', 'Quote Expired',
           'Sub-Quote Needed', 'Lead / Unassigned', 'Assigned', 'Follow Up',
           'On Hold', 'Design Phase', 'Awaiting Approval'],
    to: 'Awaiting Invoice Payment',
  },
  invoice_paid: {
    from: ['Awaiting Invoice Payment'],
    to: 'Pending Schedule',
  },
};

/**
 * Automatically transition a job's status based on an action.
 * Only transitions if the job's current status is in the 'from' list for that action.
 * Returns the new status name if transitioned, or null if no transition.
 */
export async function autoTransitionJobStatus(
  jobId: string,
  action: keyof typeof AUTO_TRANSITIONS,
  supabase?: ReturnType<typeof createClient>,
): Promise<string | null> {
  const sb = supabase || createClient();
  const rule = AUTO_TRANSITIONS[action];
  if (!rule) { console.log(`[Auto-transition] No rule for action: ${action}`); return null; }

  // Get current job status
  const { data: job, error: jobError } = await sb
    .from('jobs')
    .select('id, status_id, status:statuses(id, name)')
    .eq('id', jobId)
    .single();

  if (jobError) { console.error(`[Auto-transition] Job fetch error:`, jobError); return null; }
  if (!job) { console.log(`[Auto-transition] Job not found: ${jobId}`); return null; }

  const currentStatus = Array.isArray(job.status) ? job.status[0] : job.status;
  if (!currentStatus) { console.log(`[Auto-transition] No current status for job ${jobId}`); return null; }

  console.log(`[Auto-transition] Job ${jobId}: current="${currentStatus.name}", action="${action}", valid from=[${rule.from.join(', ')}]`);

  // Check if current status is in the 'from' list
  if (!rule.from.includes(currentStatus.name)) {
    console.log(`[Auto-transition] Skipped — "${currentStatus.name}" not in from list`);
    return null;
  }

  // Find the target status
  const { data: targetStatus } = await sb
    .from('statuses')
    .select('id, name')
    .eq('name', rule.to)
    .single();

  if (!targetStatus) return null;

  // Update job status
  await sb.from('jobs').update({ status_id: targetStatus.id }).eq('id', jobId);

  // Add system note
  await sb.from('job_notes').insert({
    job_id: jobId,
    content: `Status auto-changed from "${currentStatus.name}" to "${targetStatus.name}"`,
    type: 'system',
    is_system: true,
  });

  if (targetStatus.name === 'Ready to Invoice') {
    try {
      await fetch(`/api/jobs/${jobId}/auto-pp2`, { method: 'POST' });
    } catch (err) {
      console.error(`[Auto-transition] PP2 auto-create failed for job ${jobId}:`, err);
    }
  }

  return targetStatus.name;
}

/**
 * Centralised auto-transition rule lookup — exported so server-side code
 * (`./job-status-transitions.server.ts`) can reuse the same rules without
 * pulling client-only deps.
 */
export const AUTO_TRANSITION_RULES = AUTO_TRANSITIONS;
