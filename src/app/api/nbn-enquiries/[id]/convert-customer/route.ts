import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * Convert an NBN enquiry into a Customer record.
 *
 * Creates:
 *   - customers row (name = company || contact name, type = residential by default)
 *   - customer_contacts row (primary contact, from enquiry name/email/phone)
 *   - customer_sites row (primary site, from enquiry address — unparsed text)
 *
 * Then marks the enquiry as status=converted and links it to the new customer.
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const { data: enquiry, error: fetchErr } = await supabase
    .from("nbn_enquiries")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (fetchErr) return NextResponse.json({ error: fetchErr.message }, { status: 500 });
  if (!enquiry) return NextResponse.json({ error: "Enquiry not found" }, { status: 404 });
  if (enquiry.customer_id) {
    return NextResponse.json(
      { error: "Already linked to a customer", customerId: enquiry.customer_id },
      { status: 400 },
    );
  }

  const customerType = enquiry.company ? "commercial" : "residential";
  const customerName = enquiry.company?.trim() || enquiry.name;

  // 1. Create customer
  const { data: customer, error: custErr } = await supabase
    .from("customers")
    .insert({
      name: customerName,
      type: customerType,
      notes: `Converted from NBN enquiry ${enquiry.id} on ${new Date().toLocaleDateString("en-AU")}`,
    })
    .select("id")
    .single();
  if (custErr || !customer) {
    return NextResponse.json(
      { error: `Customer insert failed: ${custErr?.message ?? "unknown"}` },
      { status: 500 },
    );
  }

  // 2. Create primary contact
  const nameParts = enquiry.name.trim().split(/\s+/);
  const firstName = nameParts[0];
  const lastName = nameParts.slice(1).join(" ") || null;
  await supabase.from("customer_contacts").insert({
    customer_id: customer.id,
    first_name: firstName,
    last_name: lastName,
    email: enquiry.email,
    phone: enquiry.phone,
    is_primary: true,
  });

  // 3. Create primary site from the enquiry address (free-text)
  await supabase.from("customer_sites").insert({
    customer_id: customer.id,
    name: "Primary site",
    address: enquiry.address,
    is_primary: true,
  });

  // 4. Update the enquiry
  await supabase
    .from("nbn_enquiries")
    .update({
      status: "converted",
      customer_id: customer.id,
      actioned_at: new Date().toISOString(),
    })
    .eq("id", id);

  return NextResponse.json({ ok: true, customerId: customer.id });
}
