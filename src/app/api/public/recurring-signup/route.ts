import { NextRequest, NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { createRecurringPlansForSites } from "@/lib/recurring/create-plan";
import { checkRateLimit, clientIp } from "@/lib/recurring/rate-limit";

/**
 * POST /api/public/recurring-signup
 *
 * Public, no-auth endpoint called by the centrefit.com.au website when a
 * customer picks an internet plan. It creates a customer + site + recurring
 * plan, kicks off a GoCardless billing-request flow, and returns the
 * authorisation URL so the website can redirect the customer to GC.
 *
 * Auth model: this endpoint is exempted from auth middleware. We rely on:
 *   1. Origin allowlist (only requests from centrefit.com.au + previews)
 *   2. Per-IP rate limit (3 / 10min — see lib/recurring/rate-limit)
 *   3. Email + plan SKU validation
 * No CAPTCHA in v1 — easy to add later via Cloudflare Turnstile if abuse
 * becomes real (workstream C open question, brain plan).
 *
 * The downstream GC + email + Xero machinery is identical to the staff
 * `/api/recurring-plans/create` flow — they share the same orchestration
 * helper at lib/recurring/create-plan.ts. Once the customer signs the GC
 * mandate, the existing webhook chain creates the Xero RepeatingInvoice.
 *
 * Body shape:
 *   {
 *     plan_sku:        string,    // e.g. "nbn-100-20" (recurring_services.code)
 *     customer_email:  string,
 *     customer_name:   string,
 *     business_name?:  string,    // company_name; falls back to customer_name
 *     phone?:          string,
 *     site_address: {
 *       line1:    string,
 *       line2?:   string,
 *       suburb:   string,
 *       state:    string,
 *       postcode: string,
 *     },
 *     // Optional Kinetix lookup metadata (passed through from website
 *     // address-search). Stored on the site record for later reference.
 *     nbn_loc_id?:     string,
 *     nbn_technology?: string,
 *     first_invoice_date?: string | null,
 *   }
 */

const ALLOWED_ORIGINS = new Set([
  "https://centrefit.com.au",
  "https://www.centrefit.com.au",
  "https://centrefit-website.vercel.app",
  // Local dev (only matters when developer is running both repos locally).
  "http://localhost:3000",
  "http://localhost:3001",
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

interface Body {
  plan_sku?: string;
  customer_email?: string;
  customer_name?: string;
  business_name?: string;
  phone?: string;
  site_address?: {
    line1?: string;
    line2?: string;
    suburb?: string;
    state?: string;
    postcode?: string;
  };
  nbn_loc_id?: string;
  nbn_technology?: string;
  first_invoice_date?: string | null;
}

export async function POST(req: NextRequest) {
  const origin = req.headers.get("origin");
  const cors = corsHeaders(origin);

  // Origin check first — bots often skip this so it's a quick filter.
  if (origin && !ALLOWED_ORIGINS.has(origin)) {
    return NextResponse.json({ error: "Origin not allowed" }, { status: 403, headers: cors });
  }

  // Rate limit by IP.
  const ip = clientIp(req);
  const rate = checkRateLimit(ip);
  if (!rate.ok) {
    return NextResponse.json(
      { error: "Too many attempts. Please try again later." },
      { status: 429, headers: { ...cors, "Retry-After": String(rate.retryAfterSec ?? 600) } },
    );
  }

  let body: Body;
  try { body = await req.json(); }
  catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400, headers: cors }); }

  // Validate required fields.
  const email = body.customer_email?.trim().toLowerCase();
  const name = body.customer_name?.trim();
  const sku = body.plan_sku?.trim();
  const addr = body.site_address;
  if (!email || !name || !sku || !addr?.line1 || !addr.suburb || !addr.state || !addr.postcode) {
    return NextResponse.json(
      { error: "plan_sku, customer_email, customer_name, and site_address (line1/suburb/state/postcode) are required" },
      { status: 400, headers: cors },
    );
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: "Invalid email address" }, { status: 400, headers: cors });
  }
  if (!/^\d{4}$/.test(addr.postcode)) {
    return NextResponse.json({ error: "Invalid postcode" }, { status: 400, headers: cors });
  }

  let firstInvoiceDate: string | null = null;
  if (body.first_invoice_date) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(body.first_invoice_date)) {
      return NextResponse.json({ error: "first_invoice_date must be YYYY-MM-DD" }, { status: 400, headers: cors });
    }
    const today = new Date().toISOString().slice(0, 10);
    if (body.first_invoice_date < today) {
      return NextResponse.json({ error: "first_invoice_date cannot be in the past" }, { status: 400, headers: cors });
    }
    firstInvoiceDate = body.first_invoice_date;
  }

  const supabase = createServiceRoleClient();

  // Service lookup by SKU. Fail fast if the website is referencing an SKU
  // that doesn't exist or is deactivated — surfaces config drift early.
  const { data: service } = await supabase
    .from("recurring_services")
    .select("id, code, name, description, price_inc_gst, frequency, active")
    .eq("code", sku)
    .maybeSingle();
  if (!service) {
    return NextResponse.json({ error: `Unknown plan: ${sku}` }, { status: 400, headers: cors });
  }
  if (!service.active) {
    return NextResponse.json({ error: `Plan is no longer available: ${service.name}` }, { status: 400, headers: cors });
  }

  // Customer dedupe by primary-contact email. If a customer with this email
  // already exists, attach the new plan to them — keeps the contact record
  // canonical and stops duplicates piling up. Otherwise spin up a fresh
  // customer record marked commercial (the typical centrefit.com.au target).
  const businessName = body.business_name?.trim() || name;
  let customerId: string;
  let customerName: string;

  const { data: existingContact } = await supabase
    .from("customer_contacts")
    .select("id, customer_id, customers!inner(id, name)")
    .ilike("email", email)
    .eq("is_primary", true)
    .maybeSingle();

  if (existingContact?.customer_id) {
    customerId = existingContact.customer_id;
    const cust = Array.isArray(existingContact.customers) ? existingContact.customers[0] : existingContact.customers;
    customerName = cust?.name ?? businessName;
  } else {
    const { data: newCust, error: custErr } = await supabase
      .from("customers")
      .insert({ name: businessName, type: "commercial", is_active: true, notes: "Created via website recurring signup" })
      .select("id, name")
      .single();
    if (custErr || !newCust) {
      console.error("[public-signup] customer insert failed", custErr);
      return NextResponse.json({ error: "Failed to create customer" }, { status: 500, headers: cors });
    }
    customerId = newCust.id;
    customerName = newCust.name;

    await supabase.from("customer_contacts").insert({
      customer_id: customerId,
      name,
      email,
      phone: body.phone?.trim() || null,
      is_primary: true,
    });
  }

  // Always create a fresh site for the address. We don't try to dedupe
  // sites — same address arriving twice for the same customer is rare and
  // the disambiguation cost is low (staff can merge later).
  const siteName = `${businessName} — ${addr.suburb}`;
  const { data: site, error: siteErr } = await supabase
    .from("customer_sites")
    .insert({
      customer_id: customerId,
      name: siteName.slice(0, 200),
      address: [addr.line1, addr.line2].filter(Boolean).join(", "),
      suburb: addr.suburb,
      state: addr.state,
      postcode: addr.postcode,
      notes: body.nbn_loc_id
        ? `NBN LOC ID: ${body.nbn_loc_id}${body.nbn_technology ? ` (${body.nbn_technology})` : ""}`
        : null,
    })
    .select("id, name")
    .single();
  if (siteErr || !site) {
    console.error("[public-signup] site insert failed", siteErr);
    return NextResponse.json({ error: "Failed to create site" }, { status: 500, headers: cors });
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") ?? "https://crm.centrefit.com.au";
  const servicesById = new Map([[service.id, service]]);

  try {
    const result = await createRecurringPlansForSites({
      supabase,
      customer: { id: customerId, name: customerName },
      customerSitesById: new Map([[site.id, { name: site.name }]]),
      primary: { name, email, phone: body.phone ?? null },
      servicesById,
      sites: [{ siteId: site.id, items: [{ serviceId: service.id, quantity: 1 }] }],
      firstInvoiceDate,
      createdByStaffId: null,
      appUrl,
      // Public flow: skip the staff-style consolidated email since the
      // customer is going straight to the GC redirect URL on the next click.
      // The mandate-signup email path is for staff-driven flows where the
      // customer needs to receive the link asynchronously.
      sendEmail: false,
    });

    if (result.plans.length === 0 || !result.plans[0].signupUrl) {
      return NextResponse.json({ error: "Plan created but no signup URL was returned" }, { status: 500, headers: cors });
    }

    return NextResponse.json(
      {
        plan_id: result.plans[0].planId,
        redirect_url: result.plans[0].signupUrl,
      },
      { headers: cors },
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[public-signup] orchestration failed", err);
    return NextResponse.json({ error: msg }, { status: 502, headers: cors });
  }
}
