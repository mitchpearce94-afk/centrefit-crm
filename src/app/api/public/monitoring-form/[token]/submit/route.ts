import { NextRequest, NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { logDocumentActivity } from "@/lib/activity/log";
import { enqueueNotification } from "@/lib/notifications/enqueue";
import { generateMonitoringFormPdfBuffer } from "@/lib/monitoring-form/pdf";
import { sendMonitoringFormSignedEmail } from "@/lib/emails/monitoring-form";
import {
  isMaskedPin,
  maskPin,
  type MonitoringFormData,
  type MonitoringPrefill,
  type MonitoringSelections,
} from "@/lib/monitoring-form/spec";

/**
 * Public sign-and-submit endpoint for the monitoring form (Phase B).
 * Access control is the unguessable token (same model as
 * /api/quotes/respond). The status guard on the UPDATE is atomic — a link
 * opened on two devices can only be signed once (copy of the quote
 * accept/decline race defence).
 *
 * On success: sign request → signed, branded PDF rendered + stamped with the
 * audit block, stored in the private site-documents bucket under Security
 * Paperwork, the site's structured monitoring profile upserted (PINs
 * masked), the profile diff logged, staff notified, and the signer emailed
 * their copy.
 */

export async function POST(req: NextRequest, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;

  let body: {
    formData?: MonitoringFormData;
    signerName?: string;
    signerPosition?: string;
    signature?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const { formData, signerName, signerPosition, signature } = body;
  if (!formData || typeof formData !== "object") {
    return NextResponse.json({ error: "Missing form data" }, { status: 400 });
  }
  if (!signerName?.trim() || !signerPosition?.trim()) {
    return NextResponse.json({ error: "Name and position are required" }, { status: 400 });
  }
  if (!signature?.startsWith("data:image/png;base64,") || signature.length > 500_000) {
    return NextResponse.json({ error: "A valid signature is required" }, { status: 400 });
  }
  for (const u of formData.ifobUsers ?? []) {
    if (u.name?.trim() && !isMaskedPin(u.pin ?? "") && !/^\d{4}$/.test((u.pin ?? "").trim())) {
      return NextResponse.json({ error: `iFob user "${u.name}" needs a 4-digit PIN` }, { status: 400 });
    }
  }

  const sb = createServiceRoleClient();

  const { data: request } = await sb
    .from("document_sign_requests")
    .select("*")
    .eq("token", token)
    .eq("document_type", "monitoring_form")
    .maybeSingle();

  if (!request || request.status === "void") {
    return NextResponse.json({ error: "This form link has expired or been replaced" }, { status: 404 });
  }
  if (request.status === "signed") {
    return NextResponse.json({ error: "These instructions have already been signed" }, { status: 409 });
  }

  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    req.headers.get("x-real-ip") ??
    "unknown";
  const userAgent = req.headers.get("user-agent");
  const signedAt = new Date().toISOString();

  // Atomic claim — only one device can transition to signed.
  const { data: claimed } = await sb
    .from("document_sign_requests")
    .update({
      status: "signed",
      signed_at: signedAt,
      form_data: formData,
      signer_name: signerName.trim(),
      signer_position: signerPosition.trim(),
      signature_data: signature,
      signer_ip: ip,
      signer_user_agent: userAgent,
      updated_at: signedAt,
    })
    .eq("id", request.id)
    .in("status", ["sent", "viewed"])
    .select("id");

  if (!claimed || claimed.length === 0) {
    return NextResponse.json({ error: "These instructions have already been signed" }, { status: 409 });
  }

  const prefill = request.prefill as MonitoringPrefill;

  // ── Render + store the signed PDF ─────────────────────────────────────────
  let pdfBuffer: Buffer | null = null;
  let storagePath: string | null = null;
  try {
    pdfBuffer = await generateMonitoringFormPdfBuffer({
      prefill,
      formData,
      signerName: signerName.trim(),
      signerPosition: signerPosition.trim(),
      signatureDataUrl: signature,
      recipientEmail: request.recipient_email,
      requestId: request.id,
      sentAt: request.sent_at,
      viewedAt: request.viewed_at ?? signedAt,
      signedAt,
      signerIp: ip,
      signerUserAgent: userAgent,
    });

    storagePath = `sites/${request.site_id}/security/${Date.now()}-signed-monitoring-v${request.version}.pdf`;
    const { error: uploadError } = await sb.storage
      .from("site-documents")
      .upload(storagePath, pdfBuffer, { contentType: "application/pdf" });
    if (uploadError) throw new Error(`storage upload: ${uploadError.message}`);

    if (request.site_document_id) {
      await sb
        .from("site_documents")
        .update({
          storage_path: storagePath,
          mime_type: "application/pdf",
          size_bytes: pdfBuffer.length,
          status: "signed",
          updated_at: signedAt,
        })
        .eq("id", request.site_document_id);
    }
  } catch (err) {
    // The signature itself is safely recorded on the request row — a failed
    // render must not lose it. Flag on the timeline so staff can regenerate.
    console.error("[monitoring-form] signed PDF render/store failed", err);
    await logDocumentActivity({
      supabase: sb,
      documentType: "monitoring_form",
      documentId: request.id,
      eventType: "monitoring_form.pdf_failed",
      metadata: { error: err instanceof Error ? err.message : String(err) },
    });
  }

  // ── Upsert the site's structured monitoring profile (PINs masked) ─────────
  const maskedUsers = (formData.ifobUsers ?? [])
    .filter((u) => u.name?.trim())
    .map((u) => ({
      name: u.name.trim(),
      pin: isMaskedPin(u.pin ?? "") ? u.pin.trim() : maskPin(u.pin ?? ""),
      app_access: Boolean(u.app_access),
    }));
  const callList = (formData.callList ?? []).filter((r) => r.name?.trim() || r.phone?.trim());
  const details = formData.details;

  const { data: existingProfile } = await sb
    .from("site_monitoring_profiles")
    .select("selections, call_list, ifob_users, opening_hours, details")
    .eq("site_id", request.site_id)
    .maybeSingle();

  // Record what changed — the digital version of the paper form's "only
  // complete the details that are to be changed".
  const diff: Record<string, unknown> = {};
  if (existingProfile) {
    const oldSel = (existingProfile.selections ?? {}) as MonitoringSelections;
    const changedSelections: Record<string, { from: string | null; to: string | null }> = {};
    const keys = new Set([...Object.keys(oldSel), ...Object.keys(formData.selections ?? {})]);
    for (const k of keys) {
      const from = (oldSel as Record<string, string | undefined>)[k] ?? null;
      const to = (formData.selections as Record<string, string | undefined>)[k] ?? null;
      if (from !== to) changedSelections[k] = { from, to };
    }
    if (Object.keys(changedSelections).length > 0) diff.selections = changedSelections;
    if (JSON.stringify(existingProfile.call_list ?? []) !== JSON.stringify(callList)) diff.call_list = true;
    if (JSON.stringify(existingProfile.ifob_users ?? []) !== JSON.stringify(maskedUsers)) diff.ifob_users = true;
    if (JSON.stringify(existingProfile.opening_hours ?? {}) !== JSON.stringify(formData.openingHours ?? {})) diff.opening_hours = true;
  } else {
    diff.first_submission = true;
  }

  await sb.from("site_monitoring_profiles").upsert(
    {
      site_id: request.site_id,
      selections: formData.selections ?? {},
      call_list: callList,
      ifob_users: maskedUsers,
      opening_hours: formData.openingHours ?? {},
      details: {
        nearest_cross_street: details?.nearestCrossStreet ?? "",
        commencement_date: details?.commencementDate || null,
        new_client: Boolean(details?.newClient),
        facility247: Boolean(details?.facility247),
        sim_phone: details?.simPhone ?? "",
        billing_address: details?.billingAddress ?? "",
      },
      updated_from_request_id: request.id,
      updated_at: signedAt,
    },
    { onConflict: "site_id" },
  );

  // ── Audit trail + staff notification ──────────────────────────────────────
  await logDocumentActivity({
    supabase: sb,
    documentType: "monitoring_form",
    documentId: request.id,
    eventType: "monitoring_form.signed",
    actor: "recipient",
    metadata: {
      site_id: request.site_id,
      version: request.version,
      signer_name: signerName.trim(),
      signer_position: signerPosition.trim(),
      ip,
      user_agent: userAgent,
      storage_path: storagePath,
      diff,
    },
  });

  await enqueueNotification({
    typeCode: "monitoring_form.signed",
    refType: "site",
    refId: request.site_id,
    audience: { allActive: true },
    title: `${prefill.siteName} signed their monitoring instructions`,
    body: `Security Monitoring Response Instructions v${request.version} signed by ${signerName.trim()} (${signerPosition.trim()})`,
    href: `/sites/${request.site_id}`,
  });

  // ── Email the signer their copy ───────────────────────────────────────────
  if (pdfBuffer) {
    const recipients = new Set<string>([request.recipient_email]);
    if (details?.email?.trim()) recipients.add(details.email.trim());
    for (const to of recipients) {
      const result = await sendMonitoringFormSignedEmail({
        to,
        signerName: signerName.trim(),
        siteName: prefill.siteName,
        version: request.version,
        pdfBuffer,
        requestId: request.id,
      });
      if (!result.ok) {
        console.warn("[monitoring-form] signed-copy email failed", { to, error: result.error });
      }
    }
  }

  return NextResponse.json({ success: true });
}
