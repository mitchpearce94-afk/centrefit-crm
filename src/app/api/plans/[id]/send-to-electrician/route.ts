import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { sendPlanToElectricianEmail } from "@/lib/emails/plan-electrician";
import { logDocumentActivity } from "@/lib/activity/log";
import { enqueueNotification } from "@/lib/notifications/enqueue";
import { autoTransitionJobStatusServer } from "@/lib/job-status-transitions.server";

/**
 * POST /api/plans/[id]/send-to-electrician
 *
 * Looks up the state-responsible electrician from state_electricians,
 * downloads the plan's stored PDF, emails it from accounts@ with the
 * scope-quote ask, stamps plan_files.sent_to_electrician_*, fires the
 * job auto-transition to 'Plans sent to electrician', and notifies
 * staff subscribed to plan.sent_to_electrician.
 */
export async function POST(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const supabase = await createClient();

  const { data: plan, error } = await supabase
    .from("plan_files")
    .select(`
      id, name, client_name, site_name, state, revision, pdf_url,
      job_id, quote_id,
      job:jobs(id, number),
      quote:quotes(id, job_id, ref)
    `)
    .eq("id", id)
    .single();
  if (error || !plan) {
    return NextResponse.json({ error: "Plan not found" }, { status: 404 });
  }
  if (!plan.pdf_url) {
    return NextResponse.json(
      { error: "Plan has no exported PDF yet — open it in the editor and export first." },
      { status: 400 },
    );
  }
  if (!plan.state) {
    return NextResponse.json({ error: "Plan has no state set — can't pick an electrician." }, { status: 400 });
  }

  const { data: contact } = await supabase
    .from("state_electricians")
    .select("company_name, contact_name, email")
    .eq("state", plan.state)
    .maybeSingle();
  if (!contact?.email) {
    return NextResponse.json(
      { error: `No electrician contact set for ${plan.state}. Add one in Settings → Electricians.` },
      { status: 400 },
    );
  }

  // Download the stored PDF.
  let pdfBuffer: Buffer;
  try {
    const res = await fetch(plan.pdf_url);
    if (!res.ok) throw new Error(`Failed to fetch PDF: HTTP ${res.status}`);
    pdfBuffer = Buffer.from(await res.arrayBuffer());
  } catch (err) {
    return NextResponse.json(
      { error: `Couldn't load the plan PDF: ${err instanceof Error ? err.message : String(err)}` },
      { status: 502 },
    );
  }

  const directJob = plan.job ? (Array.isArray(plan.job) ? plan.job[0] : plan.job) : null;
  const quote = Array.isArray(plan.quote) ? plan.quote[0] : plan.quote;
  const jobNumber = directJob?.number ?? null;
  const jobId = plan.job_id ?? quote?.job_id ?? null;

  const planLabel = [plan.client_name, plan.site_name].filter(Boolean).join(" — ") || plan.name || "Plan";
  const filenameSafe = `${[plan.state, plan.client_name, plan.site_name, plan.revision ? "Rev " + plan.revision : null]
    .filter(Boolean)
    .join(" - ")
    .replace(/[^a-zA-Z0-9\-_ ]/g, "")}.pdf`;

  const sendResult = await sendPlanToElectricianEmail({
    to: contact.email,
    electricianName: contact.contact_name,
    state: plan.state,
    planLabel,
    planRevision: plan.revision,
    jobNumber,
    pdfBuffer,
    pdfFilename: filenameSafe,
    planFileId: plan.id,
  });
  if (!sendResult.ok) {
    return NextResponse.json({ error: sendResult.error }, { status: 502 });
  }

  const { data: { user } } = await supabase.auth.getUser();
  await supabase
    .from("plan_files")
    .update({
      sent_to_electrician_at: new Date().toISOString(),
      sent_to_electrician_email: contact.email,
      sent_to_electrician_by: user?.id ?? null,
    })
    .eq("id", id);

  await logDocumentActivity({
    supabase,
    documentType: "plan",
    documentId: id,
    eventType: "plan.sent_to_electrician",
    metadata: {
      to: contact.email,
      state: plan.state,
      contact_name: contact.contact_name ?? null,
      company_name: contact.company_name ?? null,
    },
  });

  const electricianLabel = [contact.company_name, contact.contact_name].filter(Boolean).join(" · ") || contact.email;
  await enqueueNotification({
    supabase,
    typeCode: "plan.sent_to_electrician",
    refType: "plan",
    refId: id,
    audience: { allActive: true },
    title: `Plans sent to ${plan.state} electrician`,
    body: `${planLabel} → ${electricianLabel}`,
    href: `/plans`,
  });

  if (jobId) {
    try {
      await autoTransitionJobStatusServer(jobId, "plans_sent_to_electrician", supabase);
      await enqueueNotification({
        supabase,
        typeCode: "job.plans_sent_to_electrician",
        refType: "job",
        refId: jobId,
        audience: { allActive: true },
        title: `Job moved to "Plans sent to electrician"`,
        body: jobNumber ? `${jobNumber} — ${planLabel}` : planLabel,
        href: `/jobs/${jobId}`,
      });
    } catch (err) {
      console.error(`[plans/send-to-electrician] auto-transition failed for job ${jobId}:`, err);
    }
  }

  return NextResponse.json({ ok: true, sentTo: contact.email });
}
