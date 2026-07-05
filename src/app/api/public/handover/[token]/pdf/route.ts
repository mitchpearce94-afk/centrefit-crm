import { NextRequest, NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/service";

/**
 * Serves the handover pack by token (the token in the URL is the access
 * control, same as /api/quotes/by-token). Before acceptance this is the
 * generated pack; after acceptance the linked site_documents row points at
 * the signed copy, so the same URL serves the signed version.
 */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  const sb = createServiceRoleClient();

  const { data: request } = await sb
    .from("document_sign_requests")
    .select("id, status, site_document_id, prefill")
    .eq("token", token)
    .eq("document_type", "handover")
    .maybeSingle();
  if (!request || request.status === "void") {
    return NextResponse.json({ error: "Link not found" }, { status: 404 });
  }

  let storagePath = (request.prefill as { storagePath?: string })?.storagePath ?? null;
  if (request.site_document_id) {
    const { data: doc } = await sb
      .from("site_documents")
      .select("storage_path")
      .eq("id", request.site_document_id)
      .maybeSingle();
    if (doc?.storage_path) storagePath = doc.storage_path;
  }
  if (!storagePath) return NextResponse.json({ error: "Pack unavailable" }, { status: 404 });

  const { data, error } = await sb.storage.from("site-documents").download(storagePath);
  if (error || !data) return NextResponse.json({ error: "Pack unavailable" }, { status: 404 });

  const buf = Buffer.from(await data.arrayBuffer());
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="Handover-Documentation.pdf"`,
      "Cache-Control": "no-store",
    },
  });
}
