import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service";

/**
 * POST /api/sites/create — site-first creation (D5): one pass captures the
 * site + its owner; the backing customer record is created invisibly
 * (site = billing account, 1:1). Any active staff member.
 *
 * Body: {
 *   site: { name, address?, suburb?, state?, postcode?, phone?, email?, notes? },
 *   owner: { name, abn?, billingEmail?, contactName?, contactEmail?, contactPhone? }
 * }
 *
 * The owner's billingEmail is mirrored onto customer_sites.billing_email —
 * billing paths read the site column first.
 */
export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const { data: staffRow } = await supabase.from("staff").select("is_active").eq("id", user.id).maybeSingle();
  if (!staffRow?.is_active) return NextResponse.json({ error: "Staff only" }, { status: 403 });

  let body: {
    site?: { name?: string; address?: string; suburb?: string; state?: string; postcode?: string; phone?: string; email?: string; notes?: string };
    owner?: { name?: string; abn?: string; billingEmail?: string; contactName?: string; contactEmail?: string; contactPhone?: string };
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const siteName = body.site?.name?.trim();
  const ownerName = body.owner?.name?.trim();
  if (!siteName) return NextResponse.json({ error: "Site name required" }, { status: 400 });
  if (!ownerName) return NextResponse.json({ error: "Owner name required" }, { status: 400 });

  const svc = createServiceRoleClient();

  const { data: customer, error: custErr } = await svc.from("customers").insert({
    name: ownerName,
    abn: body.owner?.abn?.trim() || null,
    billing_email: body.owner?.billingEmail?.trim() || null,
    is_active: true,
  }).select("id").single();
  if (custErr) return NextResponse.json({ error: `Owner create failed: ${custErr.message}` }, { status: 500 });

  const { data: site, error: siteErr } = await svc.from("customer_sites").insert({
    customer_id: customer.id,
    name: siteName,
    address: body.site?.address?.trim() || null,
    suburb: body.site?.suburb?.trim() || null,
    state: body.site?.state?.trim() || null,
    postcode: body.site?.postcode?.trim() || null,
    phone: body.site?.phone?.trim() || null,
    email: body.site?.email?.trim() || null,
    billing_email: body.owner?.billingEmail?.trim() || null,
    notes: body.site?.notes?.trim() || null,
  }).select("id").single();
  if (siteErr) {
    // Don't leave an orphan backing customer behind.
    await svc.from("customers").delete().eq("id", customer.id);
    return NextResponse.json({ error: `Site create failed: ${siteErr.message}` }, { status: 500 });
  }

  if (body.owner?.contactName?.trim() || body.owner?.contactEmail?.trim() || body.owner?.contactPhone?.trim()) {
    await svc.from("customer_contacts").insert({
      customer_id: customer.id,
      site_id: site.id,
      name: body.owner?.contactName?.trim() || ownerName,
      email: body.owner?.contactEmail?.trim() || null,
      phone: body.owner?.contactPhone?.trim() || null,
      is_primary: true,
    });
  }

  return NextResponse.json({ ok: true, siteId: site.id, customerId: customer.id });
}
