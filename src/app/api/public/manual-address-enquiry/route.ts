import { NextRequest, NextResponse } from "next/server";
import { Resend } from "resend";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { checkRateLimit, clientIp } from "@/lib/recurring/rate-limit";

const FROM_ADDRESS = "Centrefit NBN Orders <orders@centrefit.com.au>";
const NOTIFICATION_EMAIL = process.env.NOTIFICATION_EMAIL ?? "sales@centrefit.com.au";

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\n/g, "<br />");
}

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

  // Contact: support both the legacy single `name` and the new
  // first_name/last_name split sent by the customer-type-aware form.
  const firstName = String(form.get("first_name") ?? "").trim();
  const lastName = String(form.get("last_name") ?? "").trim();
  const legacyName = String(form.get("name") ?? "").trim();
  const name = (firstName || lastName)
    ? [firstName, lastName].filter(Boolean).join(" ")
    : legacyName;

  const email = String(form.get("email") ?? "").trim().toLowerCase();
  const phone = String(form.get("phone") ?? "").trim() || null;
  const planSku = String(form.get("plan_sku") ?? "").trim() || null;
  const line1 = String(form.get("line1") ?? "").trim();
  const line2 = String(form.get("line2") ?? "").trim() || null;
  const suburb = String(form.get("suburb") ?? "").trim();
  const state = String(form.get("state") ?? "").trim();
  const postcode = String(form.get("postcode") ?? "").trim();
  const customerType = ((String(form.get("customer_type") ?? "") || null) as
    | "residential" | "business" | null);
  const notes = String(form.get("notes") ?? "").trim() || null;

  // Residential-only ID fields (ANL compliance — same shape the regular
  // checkout collects, so staff has everything to set the customer up).
  const dob = String(form.get("dob") ?? "").trim() || null;
  const idTypeRaw = String(form.get("id_type") ?? "").trim() || null;
  const idType = idTypeRaw && ["drivers", "passport"].includes(idTypeRaw) ? idTypeRaw : null;
  const idNumber = String(form.get("id_number") ?? "").trim() || null;

  // Business-only fields.
  const businessName = String(form.get("business_name") ?? "").trim() || null;
  const abn = String(form.get("abn") ?? "").trim() || null;
  const tradingName = String(form.get("trading_name") ?? "").trim() || null;

  if (!name || !email || !line1 || !suburb || !state || !postcode) {
    return NextResponse.json(
      { error: "Name, email, and full service address are required" },
      { status: 400, headers: cors },
    );
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: "Invalid email address" }, { status: 400, headers: cors });
  }
  if (!/^\d{4}$/.test(postcode)) {
    return NextResponse.json({ error: "Invalid postcode" }, { status: 400, headers: cors });
  }
  if (customerType === "residential") {
    if (!dob || !idType || !idNumber) {
      return NextResponse.json(
        { error: "Residential signups require date of birth + ID type + ID number" },
        { status: 400, headers: cors },
      );
    }
  }
  if (customerType === "business") {
    if (!businessName || !abn) {
      return NextResponse.json(
        { error: "Business signups require business name + ABN" },
        { status: 400, headers: cors },
      );
    }
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
      plan_name: planSku,
      address: fullAddress,
      tier: "manual_lookup",
      proof_file_url: proofUrl,
      proof_file_name: proofFileName,
      notes,
      // Compliance fields — persist whichever side of the form was filled
      // so the CRM enquiry detail page renders them in the existing
      // residential / business switch (no new UI needed).
      dob,
      id_type: idType,
      id_number: idNumber,
      abn,
      trading_name: tradingName,
      raw_payload: {
        source: "website_manual_address_form",
        first_name: firstName || null,
        last_name: lastName || null,
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

  // Email the sales inbox with everything submitted. Best-effort — the
  // enquiry is already in the CRM regardless of whether this send works.
  const resendKey = process.env.RESEND_API_KEY;
  if (resendKey) {
    try {
      const resend = new Resend(resendKey);
      const appUrl = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") ?? "https://crm.centrefit.com.au";
      const ctaUrl = `${appUrl}/nbn/enquiries/${enquiry.id}`;
      const displayCustomer = customerType === "business"
        ? (businessName ?? name) + (tradingName ? ` (t/a ${tradingName})` : "")
        : name;
      const subject = `Manual address enquiry · ${displayCustomer} · ${suburb} ${postcode}`;

      const row = (label: string, value: string, opts?: { mono?: boolean }) =>
        value
          ? `<tr>
              <td style="padding:8px 12px;font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:0.05em;font-weight:600;width:170px;vertical-align:top;border-bottom:1px solid #f1f5f9">${escapeHtml(label)}</td>
              <td style="padding:8px 12px;font-size:13px;color:#0a1628;${opts?.mono ? "font-family:ui-monospace,Menlo,Consolas,monospace;" : ""}border-bottom:1px solid #f1f5f9">${value}</td>
            </tr>`
          : "";
      const section = (label: string) =>
        `<tr><td colspan="2" style="padding:18px 12px 6px 12px;font-size:11px;font-weight:700;color:#00d4ff;text-transform:uppercase;letter-spacing:0.12em;border-bottom:2px solid #00d4ff">${escapeHtml(label)}</td></tr>`;

      const html = `<!doctype html>
<html><body style="margin:0;padding:0;background:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif">
  <table cellpadding="0" cellspacing="0" width="100%" style="background:#f1f5f9">
    <tr><td align="center" style="padding:32px 12px">
      <table cellpadding="0" cellspacing="0" width="100%" style="max-width:680px;background:#ffffff;border-radius:12px;border:1px solid #e2e8f0;overflow:hidden;box-shadow:0 4px 14px rgba(10,22,40,0.06)">
        <tr><td style="padding:24px 24px 18px 24px;background:linear-gradient(135deg,#0a1628 0%,#162033 100%);color:#ffffff">
          <div style="color:#fbbf24;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.18em">CENTREFIT · MANUAL ADDRESS LOOKUP</div>
          <h1 style="margin:10px 0 4px 0;font-size:22px;font-weight:700;color:#ffffff">${escapeHtml(displayCustomer)}</h1>
          <p style="margin:0;font-size:13px;color:#cbd5e1">
            <a href="mailto:${escapeHtml(email)}" style="color:#00d4ff;text-decoration:none">${escapeHtml(email)}</a>
            ${phone ? ` &nbsp;·&nbsp; <a href="tel:${escapeHtml(phone)}" style="color:#00d4ff;text-decoration:none">${escapeHtml(phone)}</a>` : ""}
          </p>
          <p style="margin:8px 0 0;font-size:12px;color:#fbbf24">
            ⚠ Address didn't match Kinetix's geocoder — needs a manual lookup before staff can quote a plan.
          </p>
        </td></tr>
        <tr><td style="padding:6px 12px 18px 12px">
          <table cellpadding="0" cellspacing="0" width="100%" style="border-collapse:collapse">
            ${section("Customer")}
            ${row("Customer type", customerType ? customerType.charAt(0).toUpperCase() + customerType.slice(1) : "—")}
            ${row("First name", escapeHtml(firstName))}
            ${row("Last name", escapeHtml(lastName))}
            ${row("Email", `<a href="mailto:${escapeHtml(email)}" style="color:#0ea5e9;text-decoration:none">${escapeHtml(email)}</a>`)}
            ${phone ? row("Phone", `<a href="tel:${escapeHtml(phone)}" style="color:#0ea5e9;text-decoration:none">${escapeHtml(phone)}</a>`) : ""}
            ${customerType === "residential" ? `
              ${row("Date of birth", dob ? new Date(dob).toLocaleDateString("en-AU") : "")}
              ${row("ID type", idType === "drivers" ? "Driver's licence" : idType === "passport" ? "Passport" : (idType ?? ""))}
              ${row("ID number", idNumber ?? "", { mono: true })}
            ` : ""}
            ${customerType === "business" ? `
              ${row("Business name", escapeHtml(businessName ?? ""))}
              ${row("ABN", abn ?? "", { mono: true })}
              ${row("Trading name", escapeHtml(tradingName ?? ""))}
            ` : ""}

            ${section("Service address")}
            ${row("Line 1", escapeHtml(line1))}
            ${row("Line 2", escapeHtml(line2 ?? ""))}
            ${row("Suburb", escapeHtml(suburb))}
            ${row("State", escapeHtml(state))}
            ${row("Postcode", escapeHtml(postcode), { mono: true })}
            ${planSku ? row("Requested plan SKU", planSku, { mono: true }) : ""}

            ${proofFileName ? `${section("Proof of address")}${row("Filename", escapeHtml(proofFileName))}` : ""}
            ${notes ? `${section("Notes")}<tr><td colspan="2" style="padding:8px 12px;font-size:13px;color:#0a1628;white-space:pre-wrap">${escapeHtml(notes)}</td></tr>` : ""}
          </table>
        </td></tr>

        <tr><td align="center" style="padding:6px 24px 28px 24px">
          <a href="${ctaUrl}" style="display:inline-block;padding:12px 28px;background:linear-gradient(135deg,#00d4ff 0%,#0099cc 100%);color:#0a1628;font-weight:700;text-decoration:none;border-radius:8px;font-size:14px">
            Open enquiry in CRM →
          </a>
          <p style="margin:8px 0 0;font-size:11px;color:#94a3b8;font-family:ui-monospace,Menlo,Consolas,monospace">${escapeHtml(enquiry.id)}</p>
        </td></tr>

        <tr><td style="padding:14px 24px;border-top:1px solid #e2e8f0;background:#f8fafc;font-size:12px;color:#64748b;line-height:1.5">
          <strong style="color:#0a1628">Next step:</strong> open the enquiry, look the address up in Kinetix's backend, then click "Convert to recurring plan" to create the customer + site + recurring plan.
          ${proofFileName ? `<br /><br />Proof file is attached to the enquiry record (download via the CRM, not this email).` : ""}
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;

      await resend.emails.send({
        from: FROM_ADDRESS,
        to: NOTIFICATION_EMAIL,
        replyTo: email,
        subject,
        html,
      });
    } catch (err) {
      // Don't fail the whole submission if the email send breaks. The
      // enquiry is already saved; staff can pick it up via /nbn/enquiries.
      console.error("[manual-address-enquiry] sales email failed", err);
    }
  }

  return NextResponse.json({ ok: true, enquiry_id: enquiry.id }, { headers: cors });
}
