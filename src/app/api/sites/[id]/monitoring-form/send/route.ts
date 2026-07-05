import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { logDocumentActivity } from "@/lib/activity/log";
import { sendMonitoringFormRequestEmail } from "@/lib/emails/monitoring-form";
import {
  FEE_CODES,
  feeFromIncGst,
  type MonitoringPrefill,
  type MonitoringSelections,
} from "@/lib/monitoring-form/spec";

/**
 * Staff "Generate & send" for the Security Monitoring Response Instructions
 * (Phase B). Snapshots everything the CRM knows about the site — owner
 * details (respecting invoice_name), current monitoring profile, alarm-asset
 * zone schedule, and live recurring_services catalogue prices — into a
 * tokenised sign request, creates the Security Paperwork document row, and
 * emails the customer their fillable link from accounts@.
 *
 * Re-issuing voids any un-signed request for the site (DocuSign behaviour:
 * one live link at a time) and pre-fills the new form from the current
 * profile. Passing { resendRequestId } re-emails the existing link instead
 * of minting a new version.
 */

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id: siteId } = await ctx.params;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  let body: { recipientName?: string; recipientEmail?: string; resendRequestId?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const sb = createServiceRoleClient();
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || req.nextUrl.origin;

  // ── Resend an existing live link ──────────────────────────────────────────
  if (body.resendRequestId) {
    const { data: existing } = await sb
      .from("document_sign_requests")
      .select("*")
      .eq("id", body.resendRequestId)
      .eq("site_id", siteId)
      .maybeSingle();
    if (!existing || existing.status === "void" || existing.status === "signed") {
      return NextResponse.json({ error: "No live request to resend" }, { status: 404 });
    }
    const to = body.recipientEmail?.trim() || existing.recipient_email;
    const name = body.recipientName?.trim() || existing.recipient_name;
    const prefill = existing.prefill as MonitoringPrefill;
    const result = await sendMonitoringFormRequestEmail({
      to,
      recipientName: name,
      siteName: prefill.siteName,
      formUrl: `${baseUrl}/monitoring-form/${existing.token}`,
      version: existing.version,
      isReissue: prefill.isReissue,
      requestId: existing.id,
    });
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 500 });
    await sb
      .from("document_sign_requests")
      .update({ recipient_email: to, recipient_name: name, updated_at: new Date().toISOString() })
      .eq("id", existing.id);
    await logDocumentActivity({
      supabase: sb,
      documentType: "monitoring_form",
      documentId: existing.id,
      eventType: "monitoring_form.resent",
      actor: user.id,
      metadata: { to, site_id: siteId },
    });
    return NextResponse.json({ success: true, url: `${baseUrl}/monitoring-form/${existing.token}` });
  }

  // ── Fresh generation ──────────────────────────────────────────────────────
  const recipientEmail = body.recipientEmail?.trim();
  const recipientName = body.recipientName?.trim() || null;
  if (!recipientEmail || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(recipientEmail)) {
    return NextResponse.json({ error: "A valid recipient email is required" }, { status: 400 });
  }

  const [siteResult, feesResult, profileResult, assetsResult, priorResult] = await Promise.all([
    sb
      .from("customer_sites")
      .select("*, customer:customers!customer_id(id, name, abn, billing_email)")
      .eq("id", siteId)
      .single(),
    sb
      .from("recurring_services")
      .select("code, name, price_inc_gst, frequency")
      .in("code", Object.values(FEE_CODES))
      .eq("active", true),
    sb
      .from("site_monitoring_profiles")
      .select("*")
      .eq("site_id", siteId)
      .maybeSingle(),
    sb
      .from("site_assets")
      .select("device_name, location_note, is_active, asset_type:asset_types!asset_type_id(name, category)")
      .eq("site_id", siteId)
      .eq("is_active", true),
    sb
      .from("document_sign_requests")
      .select("id, status, site_document_id, version")
      .eq("site_id", siteId)
      .eq("document_type", "monitoring_form")
      .order("version", { ascending: false }),
  ]);

  if (siteResult.error || !siteResult.data) {
    return NextResponse.json({ error: "Site not found" }, { status: 404 });
  }
  const site = siteResult.data as Record<string, unknown> & {
    customer: { id: string; name: string; abn: string | null; billing_email: string | null } | null;
  };
  const customer = Array.isArray(site.customer) ? site.customer[0] ?? null : site.customer;

  // Owner's primary contact for the billing-contact pre-fill.
  const { data: ownerContact } = customer
    ? await sb
        .from("customer_contacts")
        .select("name")
        .eq("customer_id", customer.id)
        .order("is_primary", { ascending: false })
        .limit(1)
        .maybeSingle()
    : { data: null };

  // Fees from the live catalogue — never hardcoded (documentation-CONTEXT.md).
  const feeRows = feesResult.data ?? [];
  const fees: MonitoringPrefill["fees"] = {};
  for (const [key, code] of Object.entries(FEE_CODES)) {
    const row = feeRows.find((r) => r.code === code);
    if (row) {
      fees[key as keyof typeof FEE_CODES] = feeFromIncGst(
        row.code,
        row.name,
        Number(row.price_inc_gst),
        row.frequency as "monthly" | "yearly",
      );
    }
  }
  if (!fees.monitoring) {
    return NextResponse.json(
      { error: `Fee code "${FEE_CODES.monitoring}" missing from the recurring services catalogue — add it in Settings before sending` },
      { status: 422 },
    );
  }

  // CF-use-only zone schedule from the site's alarm/duress assets.
  const zoneSchedule = (assetsResult.data ?? [])
    .map((a) => ({
      ...a,
      asset_type: Array.isArray(a.asset_type) ? a.asset_type[0] ?? null : a.asset_type,
    }))
    .filter((a) => a.asset_type && ["security", "duress"].includes(a.asset_type.category))
    .map((a, i) => ({
      zone: String(i + 1),
      name: a.device_name || a.asset_type?.name || "Device",
      description: a.location_note || a.asset_type?.name || "",
    }));

  const profile = profileResult.data as
    | {
        selections: MonitoringSelections;
        call_list: MonitoringPrefill["callList"];
        ifob_users: MonitoringPrefill["ifobUsers"];
        opening_hours: MonitoringPrefill["openingHours"];
        details: Record<string, unknown> | null;
      }
    | null;
  const profileDetails = (profile?.details ?? {}) as Record<string, string | boolean | null>;

  const facilityAddress = [site.address, site.suburb, site.state, site.postcode]
    .filter(Boolean)
    .join(", ");
  const version = ((priorResult.data?.[0]?.version as number | undefined) ?? 0) + 1;
  const now = new Date().toISOString();

  const prefill: MonitoringPrefill = {
    siteName: (site.name as string) ?? "",
    details: {
      clientName: (site.invoice_name as string | null) ?? customer?.name ?? "",
      billingContactName: recipientName ?? ownerContact?.name ?? "",
      abn: customer?.abn ?? "",
      facilityName: (site.name as string) ?? "",
      facilityAddress,
      facilityPhone: (site.phone as string | null) ?? "",
      billingAddress: (profileDetails.billing_address as string) || "",
      nearestCrossStreet: (profileDetails.nearest_cross_street as string) || "",
      email: recipientEmail,
      newClient: !profile,
      commencementDate: (profileDetails.commencement_date as string) || "",
      simPhone: (profileDetails.sim_phone as string) || "",
      facility247: Boolean(profileDetails.facility247),
    },
    selections: profile?.selections ?? {},
    callList: profile?.call_list ?? [],
    ifobUsers: profile?.ifob_users ?? [],
    openingHours: profile?.opening_hours ?? {},
    zoneSchedule,
    fees,
    isReissue: Boolean(profile),
    docVersion: version,
    generatedAt: now,
  };

  // One live link at a time: void older un-signed requests and remove their
  // placeholder document rows (they never got a file).
  const stale = (priorResult.data ?? []).filter((r) => r.status === "sent" || r.status === "viewed");
  if (stale.length > 0) {
    await sb
      .from("document_sign_requests")
      .update({ status: "void", updated_at: now })
      .in("id", stale.map((r) => r.id));
    const staleDocIds = stale.map((r) => r.site_document_id).filter(Boolean);
    if (staleDocIds.length > 0) {
      await sb.from("site_documents").delete().in("id", staleDocIds).is("storage_path", null);
    }
  }

  // Document row under Security Paperwork (no file until signed).
  const { data: docRow, error: docError } = await sb
    .from("site_documents")
    .insert({
      site_id: siteId,
      category: "security",
      name: `Security Monitoring Response Instructions v${version}`,
      status: "sent",
      version,
      uploaded_by: user.id,
    })
    .select("id")
    .single();
  if (docError || !docRow) {
    return NextResponse.json({ error: docError?.message ?? "Couldn't create document row" }, { status: 500 });
  }

  const token = crypto.randomBytes(32).toString("hex");
  const { data: requestRow, error: reqError } = await sb
    .from("document_sign_requests")
    .insert({
      site_id: siteId,
      site_document_id: docRow.id,
      document_type: "monitoring_form",
      token,
      recipient_name: recipientName,
      recipient_email: recipientEmail,
      status: "sent",
      version,
      prefill,
      sent_at: now,
      created_by: user.id,
    })
    .select("id")
    .single();
  if (reqError || !requestRow) {
    await sb.from("site_documents").delete().eq("id", docRow.id);
    return NextResponse.json({ error: reqError?.message ?? "Couldn't create sign request" }, { status: 500 });
  }

  const formUrl = `${baseUrl}/monitoring-form/${token}`;
  const result = await sendMonitoringFormRequestEmail({
    to: recipientEmail,
    recipientName,
    siteName: prefill.siteName,
    formUrl,
    version,
    isReissue: prefill.isReissue,
    requestId: requestRow.id,
  });
  if (!result.ok) {
    // Roll back so staff can fix the address and try again cleanly.
    await sb.from("document_sign_requests").delete().eq("id", requestRow.id);
    await sb.from("site_documents").delete().eq("id", docRow.id);
    return NextResponse.json({ error: `Email failed: ${result.error}` }, { status: 500 });
  }

  await logDocumentActivity({
    supabase: sb,
    documentType: "monitoring_form",
    documentId: requestRow.id,
    eventType: "monitoring_form.sent",
    actor: user.id,
    metadata: { to: recipientEmail, site_id: siteId, version },
  });

  return NextResponse.json({ success: true, url: formUrl, version });
}
