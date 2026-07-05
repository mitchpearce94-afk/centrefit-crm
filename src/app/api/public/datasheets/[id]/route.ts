import { NextRequest, NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/service";

/**
 * Public datasheet endpoint — the handover pack's table of contents
 * hyperlinks each product here so the customer can open the datasheet
 * directly from the PDF (Mitchell's feedback 2026-07-05: "hyperlinked in
 * the document so they can see it straight away"). Datasheets are public
 * vendor documents, so an unauthenticated by-id route carries no data
 * sensitivity; /api/public/ is middleware-exempt.
 */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/.test(id)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const sb = createServiceRoleClient();
  const { data: sheet } = await sb
    .from("datasheets")
    .select("model, manufacturer, storage_path, source_url")
    .eq("id", id)
    .maybeSingle();
  if (!sheet) return NextResponse.json({ error: "Not found" }, { status: 404 });
  // Web-only entries (no stored PDF) bounce to the manufacturer's page.
  if (!sheet.storage_path) {
    if (sheet.source_url) return NextResponse.redirect(sheet.source_url);
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const { data, error } = await sb.storage.from("datasheets").download(sheet.storage_path);
  if (error || !data) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const buf = Buffer.from(await data.arrayBuffer());
  const filename = `${[sheet.manufacturer, sheet.model].filter(Boolean).join(" ")} Datasheet.pdf`.replace(/[^\w.\- ()]/g, "_");
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${filename}"`,
      "Cache-Control": "public, max-age=86400",
    },
  });
}
