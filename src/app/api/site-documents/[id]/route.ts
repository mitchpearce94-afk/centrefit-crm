import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service";

/**
 * DELETE /api/site-documents/[id] — admin-only hard delete of a site document
 * (row + storage object). site_documents deliberately has NO delete RLS
 * policy, so this service-role route is the only deletion path
 * (docs/documentation-CONTEXT.md Phase A).
 */
export async function DELETE(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const { data: staffRow } = await supabase.from("staff").select("role").eq("id", user.id).maybeSingle();
  if (staffRow?.role !== "admin") return NextResponse.json({ error: "Admin only" }, { status: 403 });

  const svc = createServiceRoleClient();
  const { data: doc } = await svc
    .from("site_documents")
    .select("id, storage_path, name")
    .eq("id", id)
    .maybeSingle();
  if (!doc) return NextResponse.json({ error: "Document not found" }, { status: 404 });

  if (doc.storage_path) {
    const { error: rmErr } = await svc.storage.from("site-documents").remove([doc.storage_path]);
    // Missing object is fine (already gone) — anything else should surface.
    if (rmErr && !/not.?found/i.test(rmErr.message)) {
      return NextResponse.json({ error: `Storage delete failed: ${rmErr.message}` }, { status: 500 });
    }
  }
  const { error } = await svc.from("site_documents").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true, deleted: doc.name });
}
