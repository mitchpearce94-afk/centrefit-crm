import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * POST /api/nbn-enquiries/[id]/convert-to-recurring
 *
 * Workstream D bridge. When staff clicks "Convert to recurring plan" on a
 * manual_lookup enquiry, this:
 *   1. Creates (or attaches to existing) a customer using the enquiry's email.
 *   2. Creates a customer_site for the enquiry's address.
 *   3. Returns { customerId, siteId } so the recurring wizard can pre-select.
 *
 * It does NOT create the recurring plan itself — staff still go through
 * the wizard so they can pick services + frequency. The actual plan
 * creation flows through /api/recurring-plans/create as usual; we stamp
 * the resulting plan id on the enquiry via the wizard's success path
 * (handled in wizard.tsx when from_enquiry is set).
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });

  const { data: enquiry } = await supabase
    .from("nbn_enquiries")
    .select("id, name, email, phone, company, customer_type, address, raw_payload, customer_id, recurring_plan_id")
    .eq("id", id)
    .maybeSingle();
  if (!enquiry) return NextResponse.json({ error: "Enquiry not found" }, { status: 404 });
  if (enquiry.recurring_plan_id) {
    return NextResponse.json(
      { error: "Already converted", recurringPlanId: enquiry.recurring_plan_id },
      { status: 409 },
    );
  }

  // Existing customer dedupe by primary contact email — same shape as
  // /api/public/recurring-signup so manual + automated paths converge.
  let customerId = enquiry.customer_id as string | null;
  if (!customerId) {
    const { data: existing } = await supabase
      .from("customer_contacts")
      .select("customer_id")
      .ilike("email", enquiry.email)
      .eq("is_primary", true)
      .maybeSingle();
    if (existing?.customer_id) {
      customerId = existing.customer_id;
    } else {
      const businessName = enquiry.company?.trim() || enquiry.name;
      const type = enquiry.customer_type === "residential" ? "residential" : "commercial";
      const { data: newCust, error: custErr } = await supabase
        .from("customers")
        .insert({
          name: businessName,
          type,
          is_active: true,
          notes: "Created from manual-lookup NBN enquiry",
        })
        .select("id")
        .single();
      if (custErr || !newCust) {
        return NextResponse.json({ error: custErr?.message ?? "Failed to create customer" }, { status: 500 });
      }
      customerId = newCust.id;
      await supabase.from("customer_contacts").insert({
        customer_id: customerId,
        name: enquiry.name,
        email: enquiry.email,
        phone: enquiry.phone,
        is_primary: true,
      });
    }
    await supabase.from("nbn_enquiries").update({ customer_id: customerId }).eq("id", enquiry.id);
  }

  // Build a site row from the enquiry's address payload.
  const raw = (enquiry.raw_payload ?? {}) as Record<string, unknown>;
  const line1 = (raw.line1 as string | undefined) ?? enquiry.address;
  const suburb = (raw.suburb as string | undefined) ?? "";
  const state = (raw.state as string | undefined) ?? "";
  const postcode = (raw.postcode as string | undefined) ?? "";
  const businessName = enquiry.company?.trim() || enquiry.name;

  const { data: site, error: siteErr } = await supabase
    .from("customer_sites")
    .insert({
      customer_id: customerId,
      name: suburb ? `${businessName} — ${suburb}` : businessName,
      address: line1,
      suburb: suburb || null,
      state: state || null,
      postcode: postcode || null,
      notes: "Created from manual-lookup NBN enquiry",
    })
    .select("id")
    .single();
  if (siteErr || !site) {
    return NextResponse.json({ error: siteErr?.message ?? "Failed to create site" }, { status: 500 });
  }

  return NextResponse.json({ customerId, siteId: site.id });
}
