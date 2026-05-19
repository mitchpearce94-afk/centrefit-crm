import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createRecurringPlansForSites } from "@/lib/recurring/create-plan";
import { enqueueNotification } from "@/lib/notifications/enqueue";

/**
 * POST /api/recurring-plans/create
 *
 * Staff endpoint. Resolves the customer + primary contact + sites, then
 * delegates the per-site plan creation + GC + email machinery to the shared
 * orchestration helper. The same helper is called from the public website
 * endpoint at /api/public/recurring-signup (workstream C).
 *
 * Body: {
 *   customerId, firstInvoiceDate?,
 *   sites: [{ siteId | null, items: [{ serviceId, quantity? }] }]
 * }
 */
export async function POST(req: NextRequest) {
  let body: {
    customerId?: string;
    firstInvoiceDate?: string | null;
    sites?: Array<{ siteId?: string | null; items?: Array<{ serviceId: string; quantity?: number }> }>;
    existingMandateId?: string | null;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!body.customerId || !Array.isArray(body.sites) || body.sites.length === 0) {
    return NextResponse.json({ error: "customerId and at least one site required" }, { status: 400 });
  }
  if (body.existingMandateId && !/^MD[A-Z0-9]+$/i.test(body.existingMandateId)) {
    return NextResponse.json({ error: "existingMandateId must look like 'MD000123…'" }, { status: 400 });
  }
  for (const s of body.sites) {
    if (!s.items || s.items.length === 0) {
      return NextResponse.json({ error: "Each site must have at least one item" }, { status: 400 });
    }
  }

  let firstInvoiceDate: string | null = null;
  if (body.firstInvoiceDate) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(body.firstInvoiceDate)) {
      return NextResponse.json({ error: "firstInvoiceDate must be YYYY-MM-DD" }, { status: 400 });
    }
    const today = new Date().toISOString().slice(0, 10);
    if (body.firstInvoiceDate < today) {
      return NextResponse.json({ error: "firstInvoiceDate cannot be in the past" }, { status: 400 });
    }
    firstInvoiceDate = body.firstInvoiceDate;
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });

  const { data: customer, error: custErr } = await supabase
    .from("customers")
    .select(`
      id, name, abn, xero_contact_id,
      customer_contacts(name, email, phone, is_primary),
      customer_sites(id, name, address, suburb, state, postcode)
    `)
    .eq("id", body.customerId)
    .single();
  if (custErr || !customer) {
    return NextResponse.json({ error: "Customer not found" }, { status: 404 });
  }

  const primary =
    customer.customer_contacts?.find((c: { is_primary: boolean }) => c.is_primary) ??
    customer.customer_contacts?.[0];
  if (!primary?.email) {
    return NextResponse.json(
      { error: "Customer has no primary contact email — cannot send mandate link" },
      { status: 400 },
    );
  }

  const allServiceIds = Array.from(new Set(
    body.sites.flatMap((s) => (s.items ?? []).map((i) => i.serviceId)),
  ));
  const { data: services } = await supabase
    .from("recurring_services")
    .select("id, code, name, description, price_inc_gst, frequency, account_code, active")
    .in("id", allServiceIds);
  const servicesById = new Map((services ?? []).map((s) => [s.id, s]));

  for (const id of allServiceIds) {
    const svc = servicesById.get(id);
    if (!svc) return NextResponse.json({ error: `Unknown service: ${id}` }, { status: 400 });
    if (!svc.active) {
      return NextResponse.json({ error: `Service is deactivated: ${svc.name}` }, { status: 400 });
    }
  }

  const { data: staff } = await supabase
    .from("staff")
    .select("id")
    .eq("user_id", user.id)
    .maybeSingle();

  const appUrl = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") ?? "https://crm.centrefit.com.au";

  try {
    const result = await createRecurringPlansForSites({
      supabase,
      customer: { id: customer.id, name: customer.name },
      customerSitesById: new Map(
        (customer.customer_sites ?? []).map((s: { id: string; name: string }) => [s.id, { name: s.name }]),
      ),
      primary: { name: primary.name, email: primary.email, phone: primary.phone ?? null },
      servicesById,
      sites: body.sites.map((s) => ({
        siteId: s.siteId ?? null,
        items: s.items!,
      })),
      firstInvoiceDate,
      createdByStaffId: staff?.id ?? null,
      appUrl,
      sendEmail: !body.existingMandateId,
      existingMandateId: body.existingMandateId ?? undefined,
    });

    // Notify the staffer who initiated the wizard. Different message
    // depending on whether the plan went straight to active (existing
    // mandate) or is waiting on signup.
    if (staff?.id && result.plans.length > 0) {
      const isExisting = !!body.existingMandateId;
      await enqueueNotification({
        supabase,
        typeCode: isExisting ? "mandate.active" : "recurring_plan.signup_link_sent",
        refType: "recurring_plan",
        refId: result.plans[0].planId,
        audience: { staffId: staff.id },
        title: isExisting
          ? `${customer.name} recurring billing activated`
          : "Mandate link sent",
        body: isExisting
          ? `${result.plans.length} plan${result.plans.length > 1 ? "s" : ""} attached to existing mandate ${body.existingMandateId}.`
          : `Mandate signup link${result.plans.length > 1 ? "s" : ""} emailed to ${primary.email}.`,
        href: `/invoices/recurring/${result.plans[0].planId}`,
      });
    }

    return NextResponse.json({
      planIds: result.plans.map((p) => p.planId),
      mandateLinks: result.plans.length,
      attachedExistingMandate: !!body.existingMandateId,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
