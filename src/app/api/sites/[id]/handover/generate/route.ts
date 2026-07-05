import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { logDocumentActivity } from "@/lib/activity/log";
import { sendHandoverAcceptanceEmail } from "@/lib/emails/handover";
import { assembleHandoverPack, buildHandoverInput } from "@/lib/handover/assemble";
import { brisbaneDateISO } from "@/lib/dates";

/**
 * Handover pack generation (Phase D). Two modes:
 *   - download: assemble and return the PDF (also stored under the
 *     Handover heading, status draft).
 *   - send: assemble, store, create an acceptance sign request and email
 *     the tokenised review-and-accept link (accounts@). One live link at a
 *     time, same as the monitoring form.
 */

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id: siteId } = await ctx.params;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  let body: { mode?: "download" | "send"; recipientName?: string; recipientEmail?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
  const mode = body.mode === "send" ? "send" : "download";
  const recipientEmail = body.recipientEmail?.trim();
  if (mode === "send" && (!recipientEmail || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(recipientEmail))) {
    return NextResponse.json({ error: "A valid recipient email is required" }, { status: 400 });
  }

  const sb = createServiceRoleClient();

  let input;
  try {
    input = await buildHandoverInput(sb, siteId);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Site not found" }, { status: 404 });
  }
  if (input.entries.length === 0) {
    return NextResponse.json(
      { error: "No key-information assets on this site match the datasheet library — add the site's key equipment to Assets first" },
      { status: 422 },
    );
  }

  let pack: Buffer;
  try {
    pack = await assembleHandoverPack(sb, input);
  } catch (err) {
    return NextResponse.json(
      { error: `Pack assembly failed: ${err instanceof Error ? err.message : String(err)}` },
      { status: 500 },
    );
  }

  const stamp = brisbaneDateISO();
  const fileName = `Handover Documentation - ${input.siteName} - ${stamp}.pdf`;
  const storagePath = `sites/${siteId}/handover/${Date.now()}-handover-pack.pdf`;
  const { error: uploadError } = await sb.storage
    .from("site-documents")
    .upload(storagePath, pack, { contentType: "application/pdf" });
  if (uploadError) {
    return NextResponse.json({ error: `Storage upload failed: ${uploadError.message}` }, { status: 500 });
  }

  const { data: docRow, error: docError } = await sb
    .from("site_documents")
    .insert({
      site_id: siteId,
      category: "handover",
      name: fileName,
      storage_path: storagePath,
      mime_type: "application/pdf",
      size_bytes: pack.length,
      status: mode === "send" ? "sent" : "draft",
      uploaded_by: user.id,
    })
    .select("id")
    .single();
  if (docError || !docRow) {
    return NextResponse.json({ error: docError?.message ?? "Couldn't create document row" }, { status: 500 });
  }

  if (mode === "download") {
    return new NextResponse(new Uint8Array(pack), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${fileName.replace(/[^\w.\- ()]/g, "_")}"`,
      },
    });
  }

  // send mode — void older un-signed handover requests, then issue the link.
  const now = new Date().toISOString();
  const { data: stale } = await sb
    .from("document_sign_requests")
    .select("id, site_document_id")
    .eq("site_id", siteId)
    .eq("document_type", "handover")
    .in("status", ["sent", "viewed"]);
  if (stale && stale.length > 0) {
    await sb
      .from("document_sign_requests")
      .update({ status: "void", updated_at: now })
      .in("id", stale.map((r) => r.id));
  }

  const token = crypto.randomBytes(32).toString("hex");
  const { data: requestRow, error: reqError } = await sb
    .from("document_sign_requests")
    .insert({
      site_id: siteId,
      site_document_id: docRow.id,
      document_type: "handover",
      token,
      recipient_name: body.recipientName?.trim() || null,
      recipient_email: recipientEmail!,
      status: "sent",
      version: 1,
      prefill: { siteName: input.siteName, clientName: input.clientName, dateDisplay: input.dateDisplay, storagePath },
      sent_at: now,
      created_by: user.id,
    })
    .select("id")
    .single();
  if (reqError || !requestRow) {
    return NextResponse.json({ error: reqError?.message ?? "Couldn't create sign request" }, { status: 500 });
  }

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || req.nextUrl.origin;
  const acceptUrl = `${baseUrl}/handover/${token}`;
  const result = await sendHandoverAcceptanceEmail({
    to: recipientEmail!,
    recipientName: body.recipientName?.trim() || null,
    siteName: input.siteName,
    acceptUrl,
    requestId: requestRow.id,
  });
  if (!result.ok) {
    await sb.from("document_sign_requests").delete().eq("id", requestRow.id);
    return NextResponse.json({ error: `Email failed: ${result.error}` }, { status: 500 });
  }

  await logDocumentActivity({
    supabase: sb,
    documentType: "handover",
    documentId: requestRow.id,
    eventType: "handover.sent",
    actor: user.id,
    metadata: { to: recipientEmail, site_id: siteId },
  });

  return NextResponse.json({ success: true, url: acceptUrl });
}
