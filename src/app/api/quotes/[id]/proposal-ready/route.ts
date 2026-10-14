import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { enqueueNotification } from "@/lib/notifications/enqueue";

/**
 * Staff suggestion 6B9C6180 (Lily, PM): tell the project managers when a Snap
 * Fitness proposal is ready to be completed so it isn't forgotten in the quote
 * process.
 *
 * Trigger: a NEW quote on the `snap_fitness` rule template has just been
 * inserted as a draft (the wizard calls this fire-and-forget right after the
 * insert). Anything else — other templates, already sent, not a draft — is
 * skipped with a reason. Dedupes on an existing notification for the quote so
 * repeat calls never double-notify.
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!id) return NextResponse.json({ error: "Missing quote id" }, { status: 400 });

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const { data: quote, error } = await supabase
    .from("quotes")
    .select("id, ref, status, sent_at, template_id, job_id, site_name, template:quote_rule_templates(slug)")
    .eq("id", id)
    .maybeSingle();
  if (error || !quote) {
    return NextResponse.json({ error: "Quote not found" }, { status: 404 });
  }

  const template = Array.isArray(quote.template) ? quote.template[0] : quote.template;
  const slug = (template as { slug?: string | null } | null)?.slug ?? null;

  if (slug !== "snap_fitness") {
    return NextResponse.json({ skipped: true, reason: "not_snap_fitness_template" });
  }
  if (quote.status !== "draft") {
    return NextResponse.json({ skipped: true, reason: "not_draft" });
  }
  if (quote.sent_at) {
    return NextResponse.json({ skipped: true, reason: "already_sent" });
  }

  // Dedupe — one notification per quote, ever. Service-role: notifications
  // has no INSERT policy and staff only see their own rows.
  const svc = createServiceRoleClient();
  const { count: already } = await svc
    .from("notifications")
    .select("id", { count: "exact", head: true })
    .eq("type_code", "quote.proposal_ready")
    .eq("ref_type", "quote")
    .eq("ref_id", id);
  if ((already ?? 0) > 0) {
    return NextResponse.json({ skipped: true, reason: "already_notified" });
  }

  let jobNumber: string | null = null;
  if (quote.job_id) {
    const { data: job } = await svc
      .from("jobs")
      .select("number")
      .eq("id", quote.job_id)
      .maybeSingle();
    jobNumber = (job?.number as string | null) ?? null;
  }
  const label = [quote.site_name, jobNumber ? `Job ${jobNumber}` : null, quote.ref]
    .filter(Boolean)
    .join(" · ") || "Snap Fitness quote";

  await enqueueNotification({
    typeCode: "quote.proposal_ready",
    refType: "quote",
    refId: id,
    audience: { role: "project_manager" },
    title: "Snap proposal ready to complete",
    body: `${label} — draft quote created from the plan; finish it and send as a proposal.`,
    href: `/quoting/${id}`,
    emailDetails: [
      { label: "Site", value: quote.site_name ?? "" },
      { label: "Job", value: jobNumber ?? "" },
      { label: "Quote", value: quote.ref ?? "" },
    ],
    ctaLabel: quote.ref ? `Open quote ${quote.ref}` : "Open quote",
  });

  return NextResponse.json({ ok: true });
}
