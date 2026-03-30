import { createClient } from '@/lib/supabase/client';

/**
 * Centralised job status auto-transition rules.
 * Each action defines which statuses it can transition FROM, and what it transitions TO.
 * If the job's current status isn't in the 'from' list, no transition happens.
 */
const AUTO_TRANSITIONS: Record<string, { from: string[]; to: string }> = {
  // Quote lifecycle — each step includes earlier statuses so transitions
  // still fire even if a previous step in the chain was skipped
  quote_created: {
    from: ['Lead / Unassigned', 'Assigned', 'Pending Schedule', 'Scheduled', 'Follow Up', 'On Hold', 'Design Phase', 'Awaiting Approval'],
    to: 'Quote Draft',
  },
  quote_sent: {
    from: ['Quote Draft', 'Sub-Quote Needed', 'Lead / Unassigned', 'Assigned', 'Pending Schedule', 'Scheduled', 'Follow Up', 'On Hold', 'Design Phase', 'Awaiting Approval'],
    to: 'Quote Sent',
  },
  quote_accepted: {
    from: ['Quote Draft', 'Quote Sent', 'Quote Expired', 'Sub-Quote Needed', 'Lead / Unassigned', 'Assigned', 'Pending Schedule', 'Scheduled', 'Follow Up', 'On Hold', 'Design Phase', 'Awaiting Approval'],
    to: 'Pending Schedule',
  },
  quote_declined: {
    from: ['Quote Draft', 'Quote Sent', 'Quote Expired', 'Sub-Quote Needed', 'Lead / Unassigned', 'Assigned', 'Pending Schedule', 'Scheduled', 'Design Phase', 'Awaiting Approval'],
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

  return targetStatus.name;
}

/**
 * Server-side version using the server Supabase client.
 */
export async function autoTransitionJobStatusServer(
  jobId: string,
  action: string,
  supabase: any,
): Promise<string | null> {
  const rule = AUTO_TRANSITIONS[action];
  if (!rule) return null;

  const { data: job } = await supabase
    .from('jobs')
    .select('id, status_id, status:statuses(id, name)')
    .eq('id', jobId)
    .single();

  if (!job) return null;

  const currentStatus = Array.isArray(job.status) ? job.status[0] : job.status;
  if (!currentStatus || !rule.from.includes(currentStatus.name)) return null;

  const { data: targetStatus } = await supabase
    .from('statuses')
    .select('id, name')
    .eq('name', rule.to)
    .single();

  if (!targetStatus) return null;

  await supabase.from('jobs').update({ status_id: targetStatus.id }).eq('id', jobId);
  await supabase.from('job_notes').insert({
    job_id: jobId,
    content: `Status auto-changed from "${currentStatus.name}" to "${targetStatus.name}"`,
    type: 'system',
    is_system: true,
  });

  return targetStatus.name;
}
