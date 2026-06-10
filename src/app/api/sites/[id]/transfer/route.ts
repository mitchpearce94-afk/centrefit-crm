import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service";

/**
 * Transfer a site to a different customer. Admin-only.
 *
 * What moves automatically: the site row, site-scoped contacts, and
 * everything keyed by site_id alone (assets, key info, vault refs).
 * What NEVER moves: historic jobs/quotes/invoices — they were genuinely
 * delivered/billed to the original customer and keep their customer_id.
 * Recurring plans are the caller's explicit choice:
 *   movePlans=false (site sold): plans stay with the old owner — their GC
 *     mandate is the old owner's bank account; new owner needs a new plan.
 *   movePlans=true (was filed under the wrong customer): plans follow the
 *     site — pure record fix, GC linkage is ID-based and unaffected.
 *
 * POST { targetCustomerId, movePlans }
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: siteId } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const { data: staffRow } = await supabase.from("staff").select("role").eq("id", user.id).maybeSingle();
  if (staffRow?.role !== "admin") return NextResponse.json({ error: "Admin only" }, { status: 403 });

  let body: { targetCustomerId?: string; movePlans?: boolean };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const target = body.targetCustomerId?.trim();
  const movePlans = body.movePlans === true;
  if (!target) return NextResponse.json({ error: "targetCustomerId required" }, { status: 400 });

  const svc = createServiceRoleClient();
  const [{ data: site }, { data: targetCustomer }] = await Promise.all([
    svc.from("customer_sites").select("id, name, customer_id").eq("id", siteId).maybeSingle(),
    svc.from("customers").select("id, name").eq("id", target).maybeSingle(),
  ]);
  if (!site) return NextResponse.json({ error: "Site not found" }, { status: 404 });
  if (!targetCustomer) return NextResponse.json({ error: "Target customer not found" }, { status: 404 });
  if (site.customer_id === target) return NextResponse.json({ error: "Site already belongs to that customer" }, { status: 400 });

  const now = new Date().toISOString();
  const { error: siteErr } = await svc
    .from("customer_sites")
    .update({ customer_id: target, updated_at: now })
    .eq("id", siteId);
  if (siteErr) return NextResponse.json({ error: `Site update failed: ${siteErr.message}` }, { status: 500 });

  const { data: movedContacts } = await svc
    .from("customer_contacts")
    .update({ customer_id: target })
    .eq("site_id", siteId)
    .select("id");

  let movedPlans = 0;
  let retainedPlans = 0;
  if (movePlans) {
    const { data } = await svc
      .from("recurring_plans")
      .update({ customer_id: target, updated_at: now })
      .eq("site_id", siteId)
      .select("id");
    movedPlans = data?.length ?? 0;
  } else {
    const { count } = await svc
      .from("recurring_plans")
      .select("id", { count: "exact", head: true })
      .eq("site_id", siteId)
      .in("status", ["active", "pending_mandate", "paused"]);
    retainedPlans = count ?? 0;
  }

  return NextResponse.json({
    ok: true,
    site: site.name,
    to: targetCustomer.name,
    movedContacts: movedContacts?.length ?? 0,
    movedPlans,
    retainedPlans,
  });
}
