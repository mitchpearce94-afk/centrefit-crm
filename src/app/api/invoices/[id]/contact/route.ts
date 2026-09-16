import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { getAuthedClient } from "@/lib/xero/client";
import { getXeroContact } from "@/lib/xero/contacts";
import { updateXeroInvoiceContact } from "@/lib/xero/invoices";
import { captureXeroRateLimit, isXeroRateLimited } from "@/lib/xero/rate-limit";
import { logDocumentActivity } from "@/lib/activity/log";

/**
 * POST /api/invoices/[id]/contact — bill this invoice to a different Xero
 * contact (docs/billing-contact-CONTEXT.md D3/D4/D5).
 *
 * Body: { xeroContactId: string; linkSite?: boolean }
 *   linkSite (default true) also makes the invoice's site — and its owning
 *   customer when it had no contact of its own — bill to this contact for
 *   every future invoice.
 *
 * Allowed on DRAFT and on AUTHORISED invoices with no payments; the Xero
 * layer refuses anything else. Same invoice number, PDF regenerates with
 * the new "Bill to". Nothing is emailed — Send/Resend is a separate step.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  const { data: staffRow } = await supabase.from("staff").select("is_active").eq("id", user.id).maybeSingle();
  if (!staffRow?.is_active) return NextResponse.json({ error: "Staff only" }, { status: 403 });

  const body = (await req.json().catch(() => ({}))) as { xeroContactId?: string; linkSite?: boolean };
  const xeroContactId = (body.xeroContactId ?? "").trim();
  if (!/^[0-9a-f-]{36}$/i.test(xeroContactId)) {
    return NextResponse.json({ error: "Pick a Xero contact first" }, { status: 400 });
  }
  const linkSite = body.linkSite !== false;

  const svc = createServiceRoleClient();
  const { data: invoice } = await svc
    .from("invoices")
    .select("id, status, amount_paid, xero_invoice_id, xero_invoice_number, xero_contact_id, bill_to_name, site_id, customer_id, quote:quotes(site_id), job:jobs(site_id)")
    .eq("id", id)
    .maybeSingle();
  if (!invoice) return NextResponse.json({ error: "Invoice not found" }, { status: 404 });
  if (!invoice.xero_invoice_id) return NextResponse.json({ error: "Invoice is not linked to Xero" }, { status: 400 });
  if (!(invoice.status === "draft" || (invoice.status === "authorised" && Number(invoice.amount_paid) === 0))) {
    return NextResponse.json({ error: `A ${invoice.status} invoice can't be re-billed — void and reissue instead` }, { status: 400 });
  }
  type SiteRef = { site_id: string | null } | { site_id: string | null }[] | null;
  const one = (v: SiteRef): { site_id: string | null } | null => (Array.isArray(v) ? v[0] ?? null : v ?? null);
  const siteId: string | null =
    invoice.site_id ?? one(invoice.quote as unknown as SiteRef)?.site_id ?? one(invoice.job as unknown as SiteRef)?.site_id ?? null;
  const { data: site } = siteId
    ? await svc.from("customer_sites").select("id, name, customer_id, xero_contact_id").eq("id", siteId).maybeSingle()
    : { data: null };

  const limited = await isXeroRateLimited(supabase);
  if (limited) return NextResponse.json({ error: "Xero quota exhausted — try again shortly", rateLimited: true }, { status: 429 });

  let result: Awaited<ReturnType<typeof updateXeroInvoiceContact>>;
  let contactName: string | null = null;
  try {
    const { client, conn } = await getAuthedClient();
    const contact = await getXeroContact(client, conn.tenant_id, xeroContactId);
    if (!contact) return NextResponse.json({ error: "That Xero contact no longer exists" }, { status: 400 });
    contactName = contact.name;
    result = await updateXeroInvoiceContact({
      xero: client, tenantId: conn.tenant_id, xeroInvoiceId: invoice.xero_invoice_id,
      xeroContactId: contact.id, siteName: site?.name ?? null,
    });
  } catch (err: unknown) {
    await captureXeroRateLimit(supabase, err);
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 502 });
  }

  const billToName = result.contactName ?? contactName;
  const { error: updErr } = await svc
    .from("invoices")
    .update({ xero_contact_id: xeroContactId, bill_to_name: billToName, xero_last_synced_at: new Date().toISOString(), xero_last_error: null })
    .eq("id", id);
  if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 });

  let siteLinked = false;
  if (linkSite && site) {
    const { error } = await svc.from("customer_sites").update({ xero_contact_id: xeroContactId }).eq("id", site.id);
    siteLinked = !error;
    if (site.customer_id) {
      // mirror onto the owning customer only when it has no contact of its own
      await svc.from("customers").update({ xero_contact_id: xeroContactId }).eq("id", site.customer_id).is("xero_contact_id", null);
    }
  }

  await logDocumentActivity({
    supabase: svc,
    documentType: "invoice",
    documentId: id,
    eventType: "invoice.contact_changed",
    metadata: {
      from: invoice.bill_to_name ?? invoice.xero_contact_id ?? null,
      to: billToName,
      xero_contact_id: xeroContactId,
      reference: result.reference,
      site_linked: siteLinked,
      by: user.email ?? user.id,
    },
  });

  return NextResponse.json({ ok: true, billToName, reference: result.reference, siteLinked, xeroStatus: result.status });
}
