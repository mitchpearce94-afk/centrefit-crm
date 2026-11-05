import { NextRequest, NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { builderPatchFromBody, requireStaff } from "@/lib/sites/builders";

/**
 * POST /api/sites/[id]/builders — add a builder to a site
 * (docs/job-lifecycle-CONTEXT.md D9). A site can carry as many builders as
 * tender for it; none of them touch the owner, recurring plans or mandates.
 *
 * Body: { name, abn?, contactName?, email?, phone?, address?, notes?, xeroContactId? }
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: siteId } = await params;
  const auth = await requireStaff();
  if ("error" in auth) return auth.error;

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  const { patch, error } = builderPatchFromBody(body as Record<string, unknown>);
  if (error) return NextResponse.json({ error }, { status: 400 });
  if (!patch.name) return NextResponse.json({ error: "Builder name is required" }, { status: 400 });

  const svc = createServiceRoleClient();
  const { data: site } = await svc.from("customer_sites").select("id").eq("id", siteId).maybeSingle();
  if (!site) return NextResponse.json({ error: "Site not found" }, { status: 404 });

  const { data: inserted, error: insErr } = await svc
    .from("site_builders")
    .insert({ site_id: siteId, ...patch })
    .select("id")
    .single();
  if (insErr || !inserted) return NextResponse.json({ error: insErr?.message ?? "Couldn't add the builder" }, { status: 500 });
  return NextResponse.json({ ok: true, id: inserted.id });
}
