import { NextRequest, NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { checkRateLimit, clientIp } from "@/lib/recurring/rate-limit";

/**
 * POST /api/public/manual-address-enquiry
 *
 * Workstream D fallback. When a customer's address can't be matched by
 * Kinetix's geocoder (new builds, sub-suites, regional pockets), the
 * website redirects them to a manual form which posts here. Body is
 * multipart/form-data — fields plus an optional proof-of-address file
 * (typically a lease) that gets stored in the `enquiry-proofs` bucket.
 *
 * Resulting nbn_enquiries row is tagged tier=manual_lookup so staff can
 * filter the list. From the enquiry detail page, staff can convert it to
 * a recurring plan via the wizard once they've identified the right
 * Kinetix LOC.
 *
 * Auth: same model as /api/public/recurring-signup — origin allowlist +
 * per-IP rate limit. No secret because real customers don't have one.
 */

const ALLOWED_ORIGINS = new Set([
  "https://centrefit.com.au",
  "https://www.centrefit.com.au",
  "https://centrefit-website.vercel.app",
  "http://localhost:3000",
  "http://localhost:3001",
]);

const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10 MB
const ALLOWED_MIME = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/heic",
  "image/heif",
  "image/webp",
]);

function corsHeaders(origin: string | null): HeadersInit {
  const allowed = origin && ALLOWED_ORIGINS.has(origin) ? origin : "https://centrefit.com.au";
  return {
    "Access-Control-Allow-Origin": allowed,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Vary": "Origin",
  };
}

export async function OPTIONS(req: NextRequest) {
  return new NextResponse(null, { status: 204, headers: corsHeaders(req.headers.get("origin")) });
}

export async function POST(req: NextRequest) {
  const origin = req.headers.get("origin");
  const cors = corsHeaders(origin);

  if (origin && !ALLOWED_ORIGINS.has(origin)) {
    return NextResponse.json({ error: "Origin not allowed" }, { status: 403, headers: cors });
  }

  const ip = clientIp(req);
  const rate = checkRateLimit(ip);
  if (!rate.ok) {
    return NextResponse.json(
      { error: "Too many attempts. Please try again later." },
      { status: 429, headers: { ...cors, "Retry-After": String(rate.retryAfterSec ?? 600) } },
    );
  }

  let form: FormData;
  try { form = await req.formData(); }
  catch { return NextResponse.json({ error: "Invalid form data" }, { status: 400, headers: cors }); }

  const name = String(form.get("name") ?? "").trim();
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  const phone = String(form.get("phone") ?? "").trim() || null;
  const businessName = String(form.get("business_name") ?? "").trim() || null;
  const planSku = String(form.get("plan_sku") ?? "").trim() || null;
  const line1 = String(form.get("line1") ?? "").trim();
  const line2 = String(form.get("line2") ?? "").trim() || null;
  const suburb = String(form.get("suburb") ?? "").trim();
  const state = String(form.get("state") ?? "").trim();
  const postcode = String(form.get("postcode") ?? "").trim();
  const customerType = (String(form.get("customer_type") ?? "") || null) as
    | "residential" | "business" | null;
  const notes = String(form.get("notes") ?? "").trim() || null;

  if (!name || !email || !line1 || !suburb || !state || !postcode) {
    return NextResponse.json(
      { error: "name, email, line1, suburb, state and postcode are required" },
      { status: 400, headers: cors },
    );
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: "Invalid email address" }, { status: 400, headers: cors });
  }
  if (!/^\d{4}$/.test(postcode)) {
    return NextResponse.json({ error: "Invalid postcode" }, { status: 400, headers: cors });
  }

  const supabase = createServiceRoleClient();
  const fullAddress = [line1, line2, `${suburb} ${state} ${postcode}`].filter(Boolean).join(", ");

  // Upload the proof file (if provided) to Supabase Storage. We do this
  // before inserting the enquiry so we can record the path on the row.
  let proofUrl: string | null = null;
  let proofFileName: string | null = null;
  const proof = form.get("proof") as File | null;
  if (proof && proof.size > 0) {
    if (proof.size > MAX_FILE_BYTES) {
      return NextResponse.json({ error: "Proof file is too large (max 10 MB)" }, { status: 400, headers: cors });
    }
    if (!ALLOWED_MIME.has(proof.type)) {
      return NextResponse.json({ error: "Proof file must be a PDF or image" }, { status: 400, headers: cors });
    }
    const safeName = proof.name.replace(/[^a-zA-Z0-9._-]/g, "-").slice(0, 80) || "proof";
    const path = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${safeName}`;
    const arrayBuffer = await proof.arrayBuffer();
    const { error: uploadErr } = await supabase.storage
      .from("enquiry-proofs")
      .upload(path, arrayBuffer, { contentType: proof.type, upsert: false });
    if (uploadErr) {
      console.error("[manual-address-enquiry] upload failed", uploadErr);
      return NextResponse.json({ error: "Couldn't store the uploaded file" }, { status: 500, headers: cors });
    }
    proofUrl = path; // store path; signed URLs are minted at view time
    proofFileName = proof.name;
  }

  const { data: enquiry, error: insertErr } = await supabase
    .from("nbn_enquiries")
    .insert({
      name,
      email,
      phone,
      company: businessName,
      customer_type: customerType,
      plan_name: planSku, // staff sees the SKU; legacy column reused
      address: fullAddress,
      tier: "manual_lookup",
      proof_file_url: proofUrl,
      proof_file_name: proofFileName,
      notes,
      raw_payload: {
        source: "website_manual_address_form",
        line1, line2, suburb, state, postcode,
        plan_sku: planSku,
      },
    })
    .select("id")
    .single();
  if (insertErr || !enquiry) {
    console.error("[manual-address-enquiry] insert failed", insertErr);
    return NextResponse.json({ error: "Couldn't save the enquiry" }, { status: 500, headers: cors });
  }

  return NextResponse.json({ ok: true, enquiry_id: enquiry.id }, { headers: cors });
}
