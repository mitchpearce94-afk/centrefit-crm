import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { getAuthedClient } from "@/lib/xero/client";
import { updateXeroContactDetails, type XeroContactDetailsPatch } from "@/lib/xero/contacts";
import { xeroErrorMessage } from "@/lib/xero/items";

/**
 * PATCH /api/sites/[id]/owner — edit the site's backing owner record in
 * place (site-first D4 "edit details" path: typo/phone/email fixes, NOT a
 * change of ownership). Updates the backing customer row + its primary
 * contact. Any active staff member.
 *
 * Body: { name?, abn?, billingEmail?, invoiceName?, contactName?, contactEmail?, contactPhone? }
 *
 * Same customer ⇒ the linked Xero contact is updated too (Mitchell
 * 2026-10-19): email, ABN, phone, contact person, and the display name when
 * the invoice name changed. Best-effort — the CRM save never fails on Xero;
 * the result comes back as `xero` for the toast.
 */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: siteId } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const { data: staffRow } = await supabase.from("staff").select("is_active").eq("id", user.id).maybeSingle();
  if (!staffRow?.is_active) return NextResponse.json({ error: "Staff only" }, { status: 403 });

  let body: {
    name?: string; abn?: string | null; billingEmail?: string | null;
    /** Xero billing-entity override (e.g. "Bravofit Oxley Pty Ltd"). Empty = bill as site name. */
    invoiceName?: string | null;
    /** Linked Xero contact (picker). Null unlinks. Wins over invoiceName when set. */
    xeroContactId?: string | null;
    contactName?: string | null; contactEmail?: string | null; contactPhone?: string | null;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const svc = createServiceRoleClient();
  const { data: site } = await svc
    .from("customer_sites")
    .select("id, customer_id, xero_contact_id, invoice_name, customer:customers!customer_id(name, abn, billing_email, xero_contact_id)")
    .eq("id", siteId)
    .maybeSingle();
  if (!site) return NextResponse.json({ error: "Site not found" }, { status: 404 });
  const before = (Array.isArray(site.customer) ? site.customer[0] : site.customer) as
    | { name: string | null; abn: string | null; billing_email: string | null; xero_contact_id: string | null }
    | null;

  if (body.name !== undefined && !body.name?.trim()) {
    return NextResponse.json({ error: "Owner name cannot be empty" }, { status: 400 });
  }

  const custPatch: Record<string, string | null> = {};
  if (body.name !== undefined) custPatch.name = body.name.trim();
  if (body.abn !== undefined) custPatch.abn = body.abn?.trim() || null;
  if (body.billingEmail !== undefined) custPatch.billing_email = body.billingEmail?.trim() || null;
  if (Object.keys(custPatch).length > 0) {
    const { error } = await svc.from("customers").update(custPatch).eq("id", site.customer_id);
    if (error) return NextResponse.json({ error: `Owner update failed: ${error.message}` }, { status: 500 });
  }

  // Billing email is edited HERE (Owner tab) but every billing path still
  // reads customer_sites.billing_email first — mirror it onto the site so
  // invoice delivery follows the owner's billing email. Same slot carries the
  // invoice-name override (billing concern → Owner tab per Mitchell's rule).
  if (body.billingEmail !== undefined || body.invoiceName !== undefined || body.xeroContactId !== undefined) {
    const sitePatch: Record<string, string | null> = {};
    if (body.billingEmail !== undefined) sitePatch.billing_email = body.billingEmail?.trim() || null;
    if (body.invoiceName !== undefined) sitePatch.invoice_name = body.invoiceName?.trim() || null;
    // Linked Xero contact (docs/billing-contact-CONTEXT.md D3/D6): a linked
    // contact always wins over invoice_name. Null = unlink, so the next
    // invoice finds-or-creates by invoice_name / site name again.
    if (body.xeroContactId !== undefined) {
      const xc = body.xeroContactId?.trim() || null;
      if (xc && !/^[0-9a-f-]{36}$/i.test(xc)) return NextResponse.json({ error: "Invalid Xero contact id" }, { status: 400 });
      sitePatch.xero_contact_id = xc;
    }
    const { error } = await svc
      .from("customer_sites")
      .update(sitePatch)
      .eq("id", siteId);
    if (error) return NextResponse.json({ error: `Site billing update failed: ${error.message}` }, { status: 500 });
    if (sitePatch.xero_contact_id) {
      // mirror onto the owning customer only when it has no contact of its own
      await svc.from("customers").update({ xero_contact_id: sitePatch.xero_contact_id }).eq("id", site.customer_id).is("xero_contact_id", null);
    }
  }

  // Primary contact: update the existing primary (or first) contact, or
  // create one when contact fields are supplied and none exists.
  if (body.contactName !== undefined || body.contactEmail !== undefined || body.contactPhone !== undefined) {
    const { data: contacts } = await svc
      .from("customer_contacts")
      .select("id, is_primary")
      .eq("customer_id", site.customer_id)
      .order("is_primary", { ascending: false })
      .limit(1);
    const existing = contacts?.[0];
    const contactPatch: Record<string, string | boolean | null> = {};
    if (body.contactName !== undefined) contactPatch.name = body.contactName?.trim() || null;
    if (body.contactEmail !== undefined) contactPatch.email = body.contactEmail?.trim() || null;
    if (body.contactPhone !== undefined) contactPatch.phone = body.contactPhone?.trim() || null;
    if (existing) {
      const { error } = await svc.from("customer_contacts").update(contactPatch).eq("id", existing.id);
      if (error) return NextResponse.json({ error: `Contact update failed: ${error.message}` }, { status: 500 });
    } else if (contactPatch.name || contactPatch.email || contactPatch.phone) {
      const { error } = await svc.from("customer_contacts").insert({
        customer_id: site.customer_id,
        name: (contactPatch.name as string) ?? "Owner",
        email: (contactPatch.email as string) ?? null,
        phone: (contactPatch.phone as string) ?? null,
        is_primary: true,
      });
      if (error) return NextResponse.json({ error: `Contact create failed: ${error.message}` }, { status: 500 });
    }
  }

  // ── Xero: keep the linked contact in step ─────────────────────────────
  // Site-level contact wins (the contact IS the site); legacy customer-level
  // contact otherwise. Only what actually changed is sent.
  const contactId = site.xero_contact_id ?? before?.xero_contact_id ?? null;
  const siteLevel = !!site.xero_contact_id;
  const changed = (next: string | null | undefined, prev: string | null | undefined) =>
    next !== undefined && (next?.trim() || null) !== (prev?.trim() || null);
  const xeroPatch: XeroContactDetailsPatch = {};
  if (changed(body.billingEmail, before?.billing_email)) xeroPatch.email = body.billingEmail ?? null;
  if (changed(body.abn, before?.abn)) xeroPatch.abn = body.abn ?? null;
  if (body.contactPhone !== undefined) xeroPatch.phone = body.contactPhone ?? null;
  if (body.contactName !== undefined) xeroPatch.contactPerson = body.contactName ?? null;
  if (siteLevel) {
    if (changed(body.invoiceName, site.invoice_name) && body.invoiceName?.trim()) xeroPatch.name = body.invoiceName;
  } else if (changed(body.name, before?.name) && body.name?.trim()) {
    xeroPatch.name = body.name; // legacy site-less contact is named after the owner
  }

  let xero: { updated: string[] } | { skipped: string } | { error: string };
  if (!contactId) {
    xero = { skipped: "no Xero contact linked yet — it is created on the first invoice" };
  } else if (Object.keys(xeroPatch).length === 0) {
    xero = { skipped: "nothing Xero holds was changed" };
  } else {
    try {
      const { client, conn } = await getAuthedClient();
      const sent = await updateXeroContactDetails(client, conn.tenant_id, contactId, xeroPatch);
      xero = { updated: sent };
    } catch (err) {
      xero = { error: xeroErrorMessage(err) };
    }
  }

  return NextResponse.json({ ok: true, xero });
}
