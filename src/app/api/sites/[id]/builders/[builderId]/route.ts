import { NextRequest, NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { builderPatchFromBody, requireStaff } from "@/lib/sites/builders";

/**
 * PATCH  /api/sites/[id]/builders/[builderId] — edit one builder.
 * DELETE /api/sites/[id]/builders/[builderId] — remove it from the site.
 *   Refused while a quote has been awarded to this builder (invoices point
 *   at it); tender rows for unsent quotes cascade away.
 */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string; builderId: string }> }) {
  const { id: siteId, builderId } = await params;
  const auth = await requireStaff();
  if ("error" in auth) return auth.error;

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  const { patch, error } = builderPatchFromBody(body as Record<string, unknown>);
  if (error) return NextResponse.json({ error }, { status: 400 });
  if (patch.name === null) return NextResponse.json({ error: "Builder name is required" }, { status: 400 });

  const svc = createServiceRoleClient();
  const { data: existing } = await svc.from("site_builders").select("id, name").eq("id", builderId).eq("site_id", siteId).maybeSingle();
  if (!existing) return NextResponse.json({ error: "Builder not found on this site" }, { status: 404 });
  // A renamed builder is a different Xero contact — drop the cached id unless
  // the caller linked one explicitly in the same save.
  if (patch.name !== undefined && patch.name !== existing.name && (body as Record<string, unknown>).xeroContactId === undefined) {
    patch.xero_contact_id = null;
  }
  if (Object.keys(patch).length === 0) return NextResponse.json({ ok: true, unchanged: true });

  const { error: updErr } = await svc.from("site_builders").update(patch).eq("id", builderId);
  if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string; builderId: string }> }) {
  const { id: siteId, builderId } = await params;
  const auth = await requireStaff();
  if ("error" in auth) return auth.error;

  const svc = createServiceRoleClient();
  const { count } = await svc.from("quotes").select("id", { count: "exact", head: true }).eq("accepted_builder_id", builderId);
  if ((count ?? 0) > 0) {
    return NextResponse.json({ error: "This builder has accepted a quote — it can't be removed while invoices point at it" }, { status: 409 });
  }
  const { error } = await svc.from("site_builders").delete().eq("id", builderId).eq("site_id", siteId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
