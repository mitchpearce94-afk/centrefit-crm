import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { AUTO_TRANSITION_RULES } from "./job-status-transitions";
import { tryCreatePP2ForJob } from "./invoices/auto-pp2";
import { enqueueNotification } from "./notifications/enqueue";

// Status names that have a dedicated notification type. Mapping kept here
// (vs scattered through call-sites) so it's easy to see exactly which
// transitions broadcast. status_changed isn't fired generically — it'd
// just be noise on top of the specific ones below.
const STATUS_NOTIFICATION_MAP: Record<string, { typeCode: string; title: (jobNum: string) => string }> = {
  "Ready to Invoice": {
    typeCode: "job.ready_to_invoice",
    title: (n) => `Job ${n} ready to invoice`,
  },
  "Complete": {
    typeCode: "job.complete",
    title: (n) => `Job ${n} completed`,
  },
  "Scheduled": {
    // Scheduler-driven `job.scheduled` already fires per-assignee from
    // /api/notifications/job-scheduled. Skip the generic broadcast here
    // so admins don't get the bell twice for the same event.
    typeCode: "",
    title: () => "",
  },
};

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

  // Fire status-specific notifications. Quiet for transitions we
  // intentionally skip (e.g. Scheduled — the scheduler modal already pings
  // the assignees directly).
  const notif = STATUS_NOTIFICATION_MAP[targetStatus.name];
  if (notif && notif.typeCode) {
    try {
      const { data: jobFull } = await supabase
        .from("jobs")
        .select("number, reference, customer:customers(name), site:customer_sites(name)")
        .eq("id", jobId)
        .single();
      const customer = jobFull
        ? Array.isArray(jobFull.customer) ? jobFull.customer[0] : jobFull.customer
        : null;
      const site = jobFull
        ? Array.isArray(jobFull.site) ? jobFull.site[0] : jobFull.site
        : null;
      const where =
        site?.name && customer?.name
          ? `${customer.name} — ${site.name}`
          : (customer?.name ?? site?.name ?? "");
      const jobNum = jobFull?.number ?? jobId.slice(0, 8);
      await enqueueNotification({
        supabase,
        typeCode: notif.typeCode,
        refType: "job",
        refId: jobId,
        audience: { allActive: true },
        title: notif.title(jobNum),
        body: where || undefined,
        href: `/jobs/${jobId}`,
        emailDetails: [
          { label: "Job", value: jobFull?.number ?? "" },
          { label: "Customer", value: customer?.name ?? "" },
          { label: "Site", value: site?.name ?? "" },
          { label: "Reference", value: jobFull?.reference ?? "" },
          { label: "Status", value: targetStatus.name },
        ],
        ctaLabel: jobFull?.number ? `View Job ${jobFull.number}` : "View job",
      });
    } catch (err) {
      console.error(`[Auto-transition server] notify failed for ${jobId} → ${targetStatus.name}:`, err);
    }
  }

  return targetStatus.name;
}
