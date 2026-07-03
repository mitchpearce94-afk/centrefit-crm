import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { enqueueNotification } from "@/lib/notifications/enqueue";

/**
 * POST /api/sites/[id]/change-owner — the site was SOLD to a new owner
 * (site-first D4). Admin only.
 *
 * Creates a NEW backing customer record (+ primary contact) and re-points
 * site.customer_id at it. History (jobs/quotes/invoices/plans) deliberately
 * stays on the OLD record so the CRM matches the Xero paper trail.
 *
 * Recurring plans also stay on the old record: their GC mandate is signed
 * against the old owner's bank account and cannot be inherited. Active/pending
 * plans trigger a re-mandate notification — the automated new-mandate +
 * subscription-swap flow is a separate gated build (billing-critical), so for
 * now staff set up the new mandate via the recurring wizard's "existing site"
 * path and cancel the old plan once the new one collects.
 *
 * Body: { name, abn?, billingEmail?, contactName?, contactEmail?, contactPhone? }
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: siteId } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const { data: staffRow } = await supabase.from("staff").select("role").eq("id", user.id).maybeSingle();
  if (staffRow?.role !== "admin") return NextResponse.json({ error: "Admin only" }, { status: 403 });

  let body: {
    name?: string; abn?: string | null; billingEmail?: string | null;
    contactName?: string | null; contactEmail?: string | null; contactPhone?: string | null;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const name = body.name?.trim();
  if (!name) return NextResponse.json({ error: "New owner name required" }, { status: 400 });

  const svc = createServiceRoleClient();
  const { data: site } = await svc
    .from("customer_sites")
    .select("id, name, customer_id, xero_contact_id, customer:customers!customer_id(name)")
    .eq("id", siteId)
    .maybeSingle();
  if (!site) return NextResponse.json({ error: "Site not found" }, { status: 404 });
  const oldOwner = Array.isArray(site.customer) ? site.customer[0] : site.customer;

  // New backing customer. xero_contact_id intentionally carries the site's
  // existing Xero contact — the contact IS the site (D3); its entity/ABN
  // fields may need a manual touch-up in Xero, which the notification flags.
  const { data: created, error: insErr } = await svc.from("customers").insert({
    name,
    abn: body.abn?.trim() || null,
    billing_email: body.billingEmail?.trim() || null,
    is_active: true,
    xero_contact_id: site.xero_contact_id ?? null,
  }).select("id").single();
  if (insErr) return NextResponse.json({ error: `Owner create failed: ${insErr.message}` }, { status: 500 });
  const newCustomerId = created.id;

  if (body.contactName?.trim() || body.contactEmail?.trim() || body.contactPhone?.trim()) {
    await svc.from("customer_contacts").insert({
      customer_id: newCustomerId,
      site_id: siteId,
      name: body.contactName?.trim() || name,
      email: body.contactEmail?.trim() || null,
      phone: body.contactPhone?.trim() || null,
      is_primary: true,
    });
  }

  // Re-point the site + mirror the new owner's billing email onto it (all
  // billing paths read customer_sites.billing_email first — the previous
  // owner's address must not keep receiving invoices).
  const { error: siteErr } = await svc
    .from("customer_sites")
    .update({
      customer_id: newCustomerId,
      billing_email: body.billingEmail?.trim() || null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", siteId);
  if (siteErr) return NextResponse.json({ error: `Site re-point failed: ${siteErr.message}` }, { status: 500 });

  // DD exposure check — plans stay with the old owner (their mandate), staff
  // must re-mandate the new owner.
  const { data: plans } = await svc
    .from("recurring_plans")
    .select("id, status")
    .eq("site_id", siteId)
    .in("status", ["active", "pending_mandate", "paused"]);
  const planCount = plans?.length ?? 0;

  await enqueueNotification({
    supabase: svc,
    typeCode: "site.owner_changed",
    refType: "site",
    refId: siteId,
    audience: { allActive: true },
    title: `Owner changed: ${site.name}`,
    body:
      `${oldOwner?.name ?? "Previous owner"} → ${name}.` +
      (planCount > 0
        ? ` ⚠ ${planCount} recurring plan${planCount === 1 ? "" : "s"} still collect from the previous owner's mandate — set up a new mandate for the new owner and cancel the old plan once it collects. Check the Xero contact's ABN/entity name too.`
        : " No active recurring plans on this site."),
    href: `/sites/${siteId}`,
  });

  return NextResponse.json({
    ok: true,
    newCustomerId,
    previousOwner: oldOwner?.name ?? null,
    activePlansNeedingRemandate: planCount,
  });
}
