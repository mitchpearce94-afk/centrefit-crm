import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service";

/**
 * PATCH /api/sites/[id]/owner — edit the site's backing owner record in
 * place (site-first D4 "edit details" path: typo/phone/email fixes, NOT a
 * change of ownership). Updates the backing customer row + its primary
 * contact. Any active staff member.
 *
 * Body: { name?, abn?, billingEmail?, contactName?, contactEmail?, contactPhone? }
 */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: siteId } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const { data: staffRow } = await supabase.from("staff").select("is_active").eq("id", user.id).maybeSingle();
  if (!staffRow?.is_active) return NextResponse.json({ error: "Staff only" }, { status: 403 });

  let body: {
    name?: string; abn?: string | null; billingEmail?: string | null;
    contactName?: string | null; contactEmail?: string | null; contactPhone?: string | null;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const svc = createServiceRoleClient();
  const { data: site } = await svc.from("customer_sites").select("id, customer_id").eq("id", siteId).maybeSingle();
  if (!site) return NextResponse.json({ error: "Site not found" }, { status: 404 });

  if (body.name !== undefined && !body.name?.trim()) {
    return NextResponse.json({ error: "Owner name cannot be empty" }, { status: 400 });
  }

  const custPatch: Record<string, string | null> = {};
  if (body.name !== undefined) custPatch.name = body.name.trim();
  if (body.abn !== undefined) custPatch.abn = body.abn?.trim() || null;
  if (body.billingEmail !== undefined) custPatch.billing_email = body.billingEmail?.trim() || null;
  if (Object.keys(custPatch).length > 0) {
    const { error } = await svc.from("customers").update(custPatch).eq("id", site.customer_id);
    if (error) return NextResponse.json({ error: `Owner update failed: ${error.message}` }, { status: 500 });
  }

  // Primary contact: update the existing primary (or first) contact, or
  // create one when contact fields are supplied and none exists.
  if (body.contactName !== undefined || body.contactEmail !== undefined || body.contactPhone !== undefined) {
    const { data: contacts } = await svc
      .from("customer_contacts")
      .select("id, is_primary")
      .eq("customer_id", site.customer_id)
      .order("is_primary", { ascending: false })
      .limit(1);
    const existing = contacts?.[0];
    const contactPatch: Record<string, string | boolean | null> = {};
    if (body.contactName !== undefined) contactPatch.name = body.contactName?.trim() || null;
    if (body.contactEmail !== undefined) contactPatch.email = body.contactEmail?.trim() || null;
    if (body.contactPhone !== undefined) contactPatch.phone = body.contactPhone?.trim() || null;
    if (existing) {
      const { error } = await svc.from("customer_contacts").update(contactPatch).eq("id", existing.id);
      if (error) return NextResponse.json({ error: `Contact update failed: ${error.message}` }, { status: 500 });
    } else if (contactPatch.name || contactPatch.email || contactPatch.phone) {
      const { error } = await svc.from("customer_contacts").insert({
        customer_id: site.customer_id,
        name: (contactPatch.name as string) ?? "Owner",
        email: (contactPatch.email as string) ?? null,
        phone: (contactPatch.phone as string) ?? null,
        is_primary: true,
      });
      if (error) return NextResponse.json({ error: `Contact create failed: ${error.message}` }, { status: 500 });
    }
  }

  return NextResponse.json({ ok: true });
}
