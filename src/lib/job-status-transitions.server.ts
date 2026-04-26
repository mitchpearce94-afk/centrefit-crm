import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { AUTO_TRANSITION_RULES } from "./job-status-transitions";
import { tryCreatePP2ForJob } from "./invoices/auto-pp2";

/**
 * Server-side version of autoTransitionJobStatus. Uses a server Supabase
 * client and synchronously triggers PP2 auto-create when the job moves into
 * "Ready to Invoice".
 *
 * Lives in a separate module so the client-importable transitions file
 * never pulls Xero / next/headers / supabase server into its bundle.
 */
export async function autoTransitionJobStatusServer(
  jobId: string,
  action: string,
  supabase: SupabaseClient,
): Promise<string | null> {
  const rule = AUTO_TRANSITION_RULES[action];
  if (!rule) return null;

  const { data: job } = await supabase
    .from("jobs")
    .select("id, status_id, status:statuses(id, name)")
    .eq("id", jobId)
    .single();
  if (!job) return null;

  const currentStatus = Array.isArray(job.status) ? job.status[0] : job.status;
  if (!currentStatus || !rule.from.includes(currentStatus.name)) return null;

  const { data: targetStatus } = await supabase
    .from("statuses")
    .select("id, name")
    .eq("name", rule.to)
    .single();
  if (!targetStatus) return null;

  await supabase.from("jobs").update({ status_id: targetStatus.id }).eq("id", jobId);
  await supabase.from("job_notes").insert({
    job_id: jobId,
    content: `Status auto-changed from "${currentStatus.name}" to "${targetStatus.name}"`,
    type: "system",
    is_system: true,
  });

  if (targetStatus.name === "Ready to Invoice") {
    try {
      await tryCreatePP2ForJob(supabase, jobId);
    } catch (err) {
      console.error(`[Auto-transition server] PP2 auto-create failed for job ${jobId}:`, err);
    }
  }

  return targetStatus.name;
}
