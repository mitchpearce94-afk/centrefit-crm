import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service";

/**
 * PATCH  /api/sites/[id]/builder — set or edit the builder on a site
 *        (docs/job-lifecycle-CONTEXT.md D1). The builder is a separate
 *        billing party beside the owner; nothing here touches the owner
 *        record, the recurring plans or the owner's Xero mapping.
 * DELETE /api/sites/[id]/builder — clear the builder off the site.
 *
 * Body: { name, abn?, contactName?, email?, phone?, address?, notes?, xeroContactId? }
 * Any active staff member.
 */

const FIELDS = {
  name: "builder_name",
  abn: "builder_abn",
  contactName: "builder_contact_name",
  email: "builder_email",
  phone: "builder_phone",
  address: "builder_address",
  notes: "builder_notes",
  xeroContactId: "builder_xero_contact_id",
} as const;

async function authed() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: NextResponse.json({ error: "Not authenticated" }, { status: 401 }) };
  const { data: staffRow } = await supabase.from("staff").select("is_active").eq("id", user.id).maybeSingle();
  if (!staffRow?.is_active) return { error: NextResponse.json({ error: "Staff only" }, { status: 403 }) };
  return { user };
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: siteId } = await params;
  const auth = await authed();
  if ("error" in auth) return auth.error;

  let body: Partial<Record<keyof typeof FIELDS, string | null>>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const svc = createServiceRoleClient();
  const { data: site } = await svc
    .from("customer_sites")
    .select("id, builder_name, builder_xero_contact_id")
    .eq("id", siteId)
    .maybeSingle();
  if (!site) return NextResponse.json({ error: "Site not found" }, { status: 404 });

  const patch: Record<string, string | null> = {};
  for (const [key, column] of Object.entries(FIELDS) as [keyof typeof FIELDS, string][]) {
    if (body[key] === undefined) continue;
    const v = typeof body[key] === "string" ? (body[key] as string).trim() : null;
    patch[column] = v || null;
  }
  const finalName = patch.builder_name !== undefined ? patch.builder_name : site.builder_name;
  if (!finalName) {
    return NextResponse.json({ error: "Builder name is required" }, { status: 400 });
  }
  if (patch.builder_email) {
    const bad = patch.builder_email.split(",").map((e) => e.trim()).find((e) => e && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e));
    if (bad) return NextResponse.json({ error: `"${bad}" isn't a valid email address` }, { status: 400 });
  }
  // A renamed builder is a different Xero contact — drop the cached id unless
  // the caller linked one explicitly in the same save.
  if (patch.builder_name !== undefined && patch.builder_name !== site.builder_name && body.xeroContactId === undefined) {
    patch.builder_xero_contact_id = null;
  }
  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ ok: true, unchanged: true });
  }

  const { error } = await svc.from("customer_sites").update(patch).eq("id", siteId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: siteId } = await params;
  const auth = await authed();
  if ("error" in auth) return auth.error;

  const svc = createServiceRoleClient();
  const cleared: Record<string, null> = {};
  for (const column of Object.values(FIELDS)) cleared[column] = null;
  const { error } = await svc.from("customer_sites").update(cleared).eq("id", siteId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
