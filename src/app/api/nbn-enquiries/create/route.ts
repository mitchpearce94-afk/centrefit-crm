import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

/**
 * Public endpoint the Centrefit marketing website POSTs to when someone
 * submits an NBN internet-plan order. Authenticated via a shared secret
 * passed in the X-Website-Secret header.
 *
 * Keeps the service-role key inside the CRM's Vercel project only — the
 * website never holds it.
 *
 * Env: WEBSITE_POST_SECRET (shared; generate with `openssl rand -hex 32`)
 *      SUPABASE_SERVICE_ROLE_KEY (already set for the CRM)
 */

interface CreateBody {
  name: string;
  email: string;
  phone?: string | null;
  company?: string | null;
  planName?: string | null;
  planSpeed?: string | null;
  planPrice?: string | null;
  address: string;
  nbnLocId?: string | null;
  nbnTechnology?: string | null;
  nbnSpeedTiers?: string[] | null;
  nbnRegion?: string | null;
  rawPayload?: Record<string, unknown>;
}

export async function POST(req: NextRequest) {
  const expectedSecret = process.env.WEBSITE_POST_SECRET;
  if (!expectedSecret) {
    return NextResponse.json({ error: "Server not configured" }, { status: 500 });
  }

  const providedSecret = req.headers.get("X-Website-Secret");
  if (!providedSecret || providedSecret !== expectedSecret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: CreateBody;
  try {
    body = (await req.json()) as CreateBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  // Minimal validation
  if (!body.name?.trim() || !body.email?.trim() || !body.address?.trim()) {
    return NextResponse.json(
      { error: "name, email and address are required" },
      { status: 400 },
    );
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email)) {
    return NextResponse.json({ error: "Invalid email" }, { status: 400 });
  }

  // Use service-role client so the insert works without an authenticated user.
  const cookieStore = await cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { cookies: { getAll: () => cookieStore.getAll() } },
  );

  const { data, error } = await supabase
    .from("nbn_enquiries")
    .insert({
      name: body.name.trim(),
      email: body.email.trim(),
      phone: body.phone?.trim() || null,
      company: body.company?.trim() || null,
      plan_name: body.planName ?? null,
      plan_speed: body.planSpeed ?? null,
      plan_price: body.planPrice ?? null,
      address: body.address.trim(),
      nbn_loc_id: body.nbnLocId ?? null,
      nbn_technology: body.nbnTechnology ?? null,
      nbn_speed_tiers: body.nbnSpeedTiers ?? null,
      nbn_region: body.nbnRegion ?? null,
      raw_payload: body.rawPayload ?? body,
    })
    .select("id")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, enquiryId: data.id });
}

// Allow CORS from the website (strict origin check)
export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, X-Website-Secret",
      "Access-Control-Max-Age": "86400",
    },
  });
}
