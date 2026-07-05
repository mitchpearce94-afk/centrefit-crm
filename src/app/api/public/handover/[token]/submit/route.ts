import { NextRequest, NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { logDocumentActivity } from "@/lib/activity/log";
import { enqueueNotification } from "@/lib/notifications/enqueue";
import { sendHandoverAcceptedEmail } from "@/lib/emails/handover";
import { appendAcceptancePage, buildHandoverInput, renderAcceptancePdf } from "@/lib/handover/assemble";

/**
 * Public handover acceptance (Phase D). Atomic sign claim (same race
 * defence as the monitoring form), then the acceptance + audit page is
 * appended to the stored pack with pdf-lib and the signed copy replaces
 * the document row's file (status → signed).
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;

  let body: { signerName?: string; signerPosition?: string; signature?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
  const { signerName, signerPosition, signature } = body;
  if (!signerName?.trim() || !signerPosition?.trim()) {
    return NextResponse.json({ error: "Name and position are required" }, { status: 400 });
  }
  if (!signature?.startsWith("data:image/png;base64,") || signature.length > 500_000) {
    return NextResponse.json({ error: "A valid signature is required" }, { status: 400 });
  }

  const sb = createServiceRoleClient();
  const { data: request } = await sb
    .from("document_sign_requests")
    .select("*")
    .eq("token", token)
    .eq("document_type", "handover")
    .maybeSingle();
  if (!request || request.status === "void") {
    return NextResponse.json({ error: "This link has expired or been replaced" }, { status: 404 });
  }
  if (request.status === "signed") {
    return NextResponse.json({ error: "This handover has already been accepted" }, { status: 409 });
  }

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? req.headers.get("x-real-ip") ?? "unknown";
  const signedAt = new Date().toISOString();

  const { data: claimed } = await sb
    .from("document_sign_requests")
    .update({
      status: "signed",
      signed_at: signedAt,
      signer_name: signerName.trim(),
      signer_position: signerPosition.trim(),
      signature_data: signature,
      signer_ip: ip,
      signer_user_agent: req.headers.get("user-agent"),
      updated_at: signedAt,
    })
    .eq("id", request.id)
    .in("status", ["sent", "viewed"])
    .select("id");
  if (!claimed || claimed.length === 0) {
    return NextResponse.json({ error: "This handover has already been accepted" }, { status: 409 });
  }

  // Stamp the acceptance page onto the stored pack.
  try {
    const prefill = request.prefill as { storagePath?: string };
    const storagePath = prefill?.storagePath;
    if (!storagePath) throw new Error("pack storage path missing from request");
    const { data: packFile, error: dlError } = await sb.storage.from("site-documents").download(storagePath);
    if (dlError || !packFile) throw new Error(`pack download: ${dlError?.message}`);

    const input = await buildHandoverInput(sb, request.site_id);
    const signedAtDisplay = new Date(signedAt).toLocaleString("en-AU", {
      timeZone: "Australia/Brisbane",
      day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false,
    }) + " AEST";
    const acceptance = await renderAcceptancePdf({
      input,
      signerName: signerName.trim(),
      signerPosition: signerPosition.trim(),
      signatureDataUrl: signature,
      signedAtDisplay,
      recipientEmail: request.recipient_email,
      requestId: request.id,
      signerIp: ip,
    });
    const signedPack = await appendAcceptancePage(new Uint8Array(await packFile.arrayBuffer()), acceptance);

    const signedPath = storagePath.replace(/\.pdf$/, "-signed.pdf");
    const { error: upError } = await sb.storage
      .from("site-documents")
      .upload(signedPath, signedPack, { contentType: "application/pdf", upsert: true });
    if (upError) throw new Error(`signed upload: ${upError.message}`);

    if (request.site_document_id) {
      await sb
        .from("site_documents")
        .update({ storage_path: signedPath, size_bytes: signedPack.length, status: "signed", updated_at: signedAt })
        .eq("id", request.site_document_id);
    }
  } catch (err) {
    console.error("[handover] acceptance stamping failed", err);
    await logDocumentActivity({
      supabase: sb,
      documentType: "handover",
      documentId: request.id,
      eventType: "handover.stamp_failed",
      metadata: { error: err instanceof Error ? err.message : String(err) },
    });
  }

  await logDocumentActivity({
    supabase: sb,
    documentType: "handover",
    documentId: request.id,
    eventType: "handover.accepted",
    actor: "recipient",
    metadata: { site_id: request.site_id, signer_name: signerName.trim(), signer_position: signerPosition.trim(), ip },
  });

  const prefillMeta = request.prefill as { siteName?: string };
  await enqueueNotification({
    typeCode: "handover.accepted",
    refType: "site",
    refId: request.site_id,
    audience: { allActive: true },
    title: `${prefillMeta.siteName ?? "A site"} accepted their handover`,
    body: `Handover documentation signed by ${signerName.trim()} (${signerPosition.trim()})`,
    href: `/sites/${request.site_id}`,
  });

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || req.nextUrl.origin;
  const result = await sendHandoverAcceptedEmail({
    to: request.recipient_email,
    signerName: signerName.trim(),
    siteName: prefillMeta.siteName ?? "your facility",
    viewUrl: `${baseUrl}/handover/${token}`,
    requestId: request.id,
  });
  if (!result.ok) console.warn("[handover] accepted email failed", result.error);

  return NextResponse.json({ success: true });
}
