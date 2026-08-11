import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getAuthedClient } from "@/lib/xero/client";
import { findOrCreateContact } from "@/lib/xero/contacts";
import {
  buildQuoteReferenceLine,
  createXeroInvoice,
  type XeroLineItemInput,
} from "@/lib/xero/invoices";

type InvoiceType = "full" | "progress_pp1" | "progress_pp2" | "adhoc";

interface CreateBody {
  type: InvoiceType;
  quoteId?: string;
  jobId?: string;
  customerId?: string;
  // Ad-hoc only
  siteId?: string;
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
  let siteId: string | null = null;
  let quoteId: string | null = body.quoteId ?? null;
  let jobId: string | null = body.jobId ?? null;
  let reference: string | undefined;
  let headerDescription = "";
  let lineItems: XeroLineItemInput[] = [];
  let subtotal = 0;
  // For quote-linked paths we also stash freeform site label/address from
  // the quote so the description can lead with "Site: ..." even when the
  // quote pre-dates the customer_sites split (legacy text fields).
  let siteHeader: string | undefined;

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
    // Site context so the Xero contact uses the SITE name (not the customer
    // name) — same site-first billing rule as recurring/quote invoices.
    siteId = body.siteId ?? null;
    const pricedLines = body.lineItems;
    headerDescription = body.description ?? "";
    subtotal = pricedLines.reduce((s, li) => s + ((li.unitAmount ?? 0) * (li.quantity ?? 1)), 0);

    // Fold the narrative (job description + checklist + work log) into the
    // FIRST priced line so the Xero invoice shows one line carrying both the
    // proof of work and the charge — not a $0 description line followed by a
    // separate priced line (Mitchell, 2026-07-09). Matches how quote-linked
    // invoices render (scope text + price on one line).
    if (headerDescription.trim()) {
      const [first, ...rest] = pricedLines;
      // First row's own description is optional — when blank, the narrative
      // alone is the line text (no stray separator, no "." placeholder).
      lineItems = [
        {
          ...first,
          description: [headerDescription.trim(), first.description?.trim()].filter(Boolean).join("\n\n"),
        },
        ...rest,
      ];
    } else {
      lineItems = pricedLines;
    }
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
    siteId = quote.site_id ?? null;
    jobId = jobId ?? quote.job_id ?? null;
    reference = quote.ref;
    if (quote.site_name || quote.site_address) {
      siteHeader = `Site: ${[quote.site_name, quote.site_address].filter(Boolean).join(" — ")}`;
    } else if (quote.site_id) {
      // Site-linked quote with no legacy freeform fields — pull the site so
      // the invoice line still leads with "Site: ...".
      const { data: s } = await supabase
        .from("customer_sites")
        .select("name, address, suburb, state, postcode")
        .eq("id", quote.site_id)
        .maybeSingle();
      if (s) {
        const addr = [s.address, s.suburb, s.state, s.postcode].filter(Boolean).join(", ");
        siteHeader = `Site: ${[s.name, addr].filter(Boolean).join(" — ")}`;
      }
    }

    const pricing = quote.pricing_snapshot as { totalExGST?: number; pp1?: { total: number }; pp2?: { total: number } } | null;
    if (!pricing) {
      return NextResponse.json({ error: "Quote has no pricing snapshot" }, { status: 400 });
    }

    // Reference-only invoicing (Mitchell, 2026-07-16): the accepted quote is
    // the scope document — the invoice just points at it, no scope text.
    if (body.type === "full") {
      if (quote.quote_type === "progress") {
        return NextResponse.json(
          { error: "This quote is a progress quote — use progress_pp1 / progress_pp2" },
          { status: 400 },
        );
      }
      headerDescription = `Installation per quote ${quote.ref}`;
      lineItems = buildQuoteReferenceLine({
        quoteRef: quote.ref,
        amount: Number(pricing.totalExGST ?? 0),
        siteHeader,
      });
      subtotal = Number(pricing.totalExGST ?? 0);
    } else if (body.type === "progress_pp1" || body.type === "progress_pp2") {
      if (quote.quote_type !== "progress") {
        return NextResponse.json(
          { error: "This quote is not a progress quote — use type=full" },
          { status: 400 },
        );
      }
      const isPP1 = body.type === "progress_pp1";
      // PP2 completes the accepted quote's total: bill (total − PP1), not the
      // stored pp2.total — snapshots saved before 2026-08-01 carried a pp2
      // that was 5% (the uplift) short of the headline total the customer
      // accepted.
      const totalEx = Number(pricing.totalExGST ?? 0);
      const pp1Ex = Number(pricing.pp1?.total ?? 0);
      const pp2Derived =
        totalEx > 0 && pp1Ex > 0 ? Number((totalEx - pp1Ex).toFixed(2)) : Number(pricing.pp2?.total ?? 0);
      const amount = isPP1 ? pp1Ex : pp2Derived;
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
      headerDescription = header;
      lineItems = buildQuoteReferenceLine({
        quoteRef: quote.ref,
        amount,
        siteHeader,
        milestone: isPP1
          ? "Progress Payment 1 (on acceptance)"
          : "Progress Payment 2 (on completion)",
      });
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
    .select("id, name, abn, xero_contact_id, billing_email, customer_contacts(email, phone, is_primary)")
    .eq("id", customerId)
    .single();
  if (custErr || !customer) {
    return NextResponse.json({ error: "Customer not found" }, { status: 404 });
  }

  const primary =
    customer.customer_contacts?.find((c: { is_primary: boolean }) => c.is_primary) ??
    customer.customer_contacts?.[0];

  // Resolve site row if we have one, so the contact gets the per-site
  // mapping + address attached (workstream Xero polish, 2026-04-29).
  let siteRow: { id: string; name: string; invoice_name: string | null; address: string | null; suburb: string | null; state: string | null; postcode: string | null; xero_contact_id: string | null; billing_email: string | null } | null = null;
  if (siteId) {
    const { data } = await supabase
      .from("customer_sites")
      .select("id, name, invoice_name, address, suburb, state, postcode, xero_contact_id, billing_email")
      .eq("id", siteId)
      .maybeSingle();
    if (data) siteRow = data;
  }

  // ── Create in Xero ──
  let xeroResult;
  try {
    const { client: xero, conn } = await getAuthedClient();
    const xeroContactId = await findOrCreateContact(
      supabase,
      xero,
      conn.tenant_id,
      {
        id: customer.id,
        name: customer.name,
        xero_contact_id: customer.xero_contact_id,
        email: primary?.email ?? null,
        billing_email: customer.billing_email ?? null,
        phone: primary?.phone ?? null,
        abn: customer.abn ?? null,
      },
      siteRow,
    );

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
      site_id: siteRow?.id ?? null,
      description: headerDescription,
      line_items: lineItems,
      subtotal: xeroResult.subTotal,
      gst,
      total: xeroResult.total,
      amount_due: xeroResult.amountDue,
      amount_paid: Math.max(0, xeroResult.total - xeroResult.amountDue),
      status: xeroResult.status.toLowerCase() === "paid" ? "paid"
        : xeroResult.status.toLowerCase() === "voided" ? "void"
        : xeroResult.status.toLowerCase() === "draft" ? "draft"
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
