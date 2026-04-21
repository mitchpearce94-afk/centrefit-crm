import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getAuthedClient } from "@/lib/xero/client";
import { findOrCreateContact } from "@/lib/xero/contacts";
import {
  createXeroInvoice,
  formatScopeDescription,
  type XeroLineItemInput,
} from "@/lib/xero/invoices";

type InvoiceType = "full" | "progress_pp1" | "progress_pp2" | "adhoc";

interface CreateBody {
  type: InvoiceType;
  quoteId?: string;
  jobId?: string;
  customerId?: string;
  // Ad-hoc only
  description?: string;
  lineItems?: XeroLineItemInput[];
  dueDate?: string; // ISO
}

export async function POST(req: NextRequest) {
  let body: CreateBody;
  try {
    body = (await req.json()) as CreateBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!body.type) {
    return NextResponse.json({ error: "type is required" }, { status: 400 });
  }

  const supabase = await createClient();

  // ── Build line items + resolve customer depending on mode ──
  let customerId: string | null = null;
  let quoteId: string | null = body.quoteId ?? null;
  let jobId: string | null = body.jobId ?? null;
  let reference: string | undefined;
  let headerDescription = "";
  let lineItems: XeroLineItemInput[] = [];
  let subtotal = 0;

  if (body.type === "adhoc") {
    if (!body.customerId) {
      return NextResponse.json(
        { error: "customerId is required for ad-hoc invoices" },
        { status: 400 },
      );
    }
    if (!body.lineItems || body.lineItems.length === 0) {
      return NextResponse.json(
        { error: "lineItems are required for ad-hoc invoices" },
        { status: 400 },
      );
    }
    customerId = body.customerId;
    lineItems = body.lineItems;
    headerDescription = body.description ?? "";
    subtotal = lineItems.reduce((s, li) => s + (li.unitAmount * (li.quantity ?? 1)), 0);
  } else {
    // Quote-linked: full / progress_pp1 / progress_pp2
    if (!quoteId) {
      return NextResponse.json(
        { error: "quoteId is required for quote-linked invoices" },
        { status: 400 },
      );
    }
    const { data: quote, error: quoteErr } = await supabase
      .from("quotes")
      .select("*")
      .eq("id", quoteId)
      .single();
    if (quoteErr || !quote) {
      return NextResponse.json({ error: "Quote not found" }, { status: 404 });
    }
    if (quote.status !== "accepted") {
      return NextResponse.json(
        { error: "Can only invoice an accepted quote" },
        { status: 400 },
      );
    }
    customerId = quote.customer_id;
    jobId = jobId ?? quote.job_id ?? null;
    reference = quote.ref;

    const pricing = quote.pricing_snapshot as { totalExGST?: number; pp1?: { total: number }; pp2?: { total: number } } | null;
    if (!pricing) {
      return NextResponse.json({ error: "Quote has no pricing snapshot" }, { status: 400 });
    }

    const siteInfo = {
      site_sqm: quote.site_sqm ?? 0,
      door_count: quote.door_count ?? 0,
      external_camera_count: quote.external_camera_count ?? 0,
      concrete_mount_black: quote.concrete_mount_black ?? 0,
      concrete_mount_white: quote.concrete_mount_white ?? 0,
      cardio_count: quote.cardio_count ?? 0,
      tv_count: quote.tv_count ?? 0,
      ceiling_tv_count: quote.ceiling_tv_count ?? 0,
      wall_tv_mount_count: quote.wall_tv_mount_count ?? 0,
      ceiling_tv_mount_count: quote.ceiling_tv_mount_count ?? 0,
      separate_studio_zone: quote.separate_studio_zone ?? false,
    };

    if (body.type === "full") {
      if (quote.quote_type === "progress") {
        return NextResponse.json(
          { error: "This quote is a progress quote — use progress_pp1 / progress_pp2" },
          { status: 400 },
        );
      }
      const description = formatScopeDescription(
        quote.device_counts ?? {},
        siteInfo,
        quote.scope_overrides ?? null,
        `CentreFit Installation — Quote ${quote.ref}`,
      );
      headerDescription = `Installation per quote ${quote.ref}`;
      lineItems = [{
        description,
        quantity: 1,
        unitAmount: Number(pricing.totalExGST ?? 0),
      }];
      subtotal = Number(pricing.totalExGST ?? 0);
    } else if (body.type === "progress_pp1" || body.type === "progress_pp2") {
      if (quote.quote_type !== "progress") {
        return NextResponse.json(
          { error: "This quote is not a progress quote — use type=full" },
          { status: 400 },
        );
      }
      const isPP1 = body.type === "progress_pp1";
      const amount = isPP1 ? Number(pricing.pp1?.total ?? 0) : Number(pricing.pp2?.total ?? 0);
      if (amount <= 0) {
        return NextResponse.json(
          { error: `No ${isPP1 ? "PP1" : "PP2"} amount in the quote pricing snapshot` },
          { status: 400 },
        );
      }

      // Block duplicate PP invoices for the same quote
      const { data: existing } = await supabase
        .from("invoices")
        .select("id")
        .eq("quote_id", quoteId)
        .eq("invoice_type", body.type)
        .not("status", "eq", "void")
        .maybeSingle();
      if (existing) {
        return NextResponse.json(
          { error: `A ${isPP1 ? "PP1" : "PP2"} invoice for this quote already exists` },
          { status: 409 },
        );
      }

      const header = isPP1
        ? `Progress Payment 1 — On Acceptance (Quote ${quote.ref})`
        : `Progress Payment 2 — On Completion (Quote ${quote.ref})`;
      const description = formatScopeDescription(
        quote.device_counts ?? {},
        siteInfo,
        quote.scope_overrides ?? null,
        header,
      );
      headerDescription = header;
      lineItems = [{
        description,
        quantity: 1,
        unitAmount: amount,
      }];
      subtotal = amount;
    }
  }

  if (!customerId) {
    return NextResponse.json({ error: "Missing customer reference" }, { status: 400 });
  }
  if (lineItems.length === 0) {
    return NextResponse.json({ error: "No line items to invoice" }, { status: 400 });
  }

  // ── Resolve customer + Xero contact ──
  const { data: customer, error: custErr } = await supabase
    .from("customers")
    .select("id, name, abn, xero_contact_id, customer_contacts(email, phone, is_primary)")
    .eq("id", customerId)
    .single();
  if (custErr || !customer) {
    return NextResponse.json({ error: "Customer not found" }, { status: 404 });
  }

  const primary =
    customer.customer_contacts?.find((c: { is_primary: boolean }) => c.is_primary) ??
    customer.customer_contacts?.[0];

  // ── Create in Xero ──
  let xeroResult;
  try {
    const { client: xero, conn } = await getAuthedClient();
    const xeroContactId = await findOrCreateContact(supabase, xero, conn.tenant_id, {
      id: customer.id,
      name: customer.name,
      xero_contact_id: customer.xero_contact_id,
      email: primary?.email ?? null,
      phone: primary?.phone ?? null,
      abn: customer.abn ?? null,
    });

    xeroResult = await createXeroInvoice({
      xero,
      tenantId: conn.tenant_id,
      xeroContactId,
      lineItems,
      reference,
      dueDate: body.dueDate ? new Date(body.dueDate) : undefined,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: `Xero error: ${message}` },
      { status: 502 },
    );
  }

  // ── Persist local record ──
  const gst = Number((xeroResult.total - xeroResult.subTotal).toFixed(2));
  const { data: inserted, error: insErr } = await supabase
    .from("invoices")
    .insert({
      invoice_type: body.type,
      quote_id: quoteId,
      job_id: jobId,
      customer_id: customerId,
      description: headerDescription,
      line_items: lineItems,
      subtotal: xeroResult.subTotal,
      gst,
      total: xeroResult.total,
      amount_due: xeroResult.amountDue,
      amount_paid: Math.max(0, xeroResult.total - xeroResult.amountDue),
      status: xeroResult.status.toLowerCase() === "paid" ? "paid"
        : xeroResult.status.toLowerCase() === "voided" ? "void"
        : "authorised",
      xero_invoice_id: xeroResult.invoiceID,
      xero_invoice_number: xeroResult.invoiceNumber,
      xero_online_url: xeroResult.onlineInvoiceUrl,
      xero_last_synced_at: new Date().toISOString(),
      issued_at: new Date().toISOString(),
      due_date: xeroResult.dueDate,
    })
    .select()
    .single();

  if (insErr || !inserted) {
    // Xero invoice exists but local insert failed — surface loudly so Mitchell knows.
    return NextResponse.json(
      {
        error: `Created Xero invoice ${xeroResult.invoiceNumber ?? xeroResult.invoiceID} but failed to save locally: ${insErr?.message ?? "unknown"}`,
        xero_invoice_id: xeroResult.invoiceID,
      },
      { status: 500 },
    );
  }

  return NextResponse.json({ invoice: inserted });
}
