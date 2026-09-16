import type { XeroClient } from "xero-node";
import { brisbaneDateISO } from "@/lib/dates";
import { DEFAULT_SALES_ACCOUNT_CODE } from "@/lib/xero/account-codes";
import {
  generateScopeOfWorks,
  manualScopeDocument,
  renderScopeAsText,
  type ScopeOverrides,
  type SiteInfo,
  type BOMLineForScope,
  type ProductForScope,
} from "@/lib/quote-engine";

// Centrefit's default Xero sales account code. Sue used 200 historically —
// if this ever changes, update here + let the rest of the code flow through.
export { DEFAULT_SALES_ACCOUNT_CODE };
// Australian GST on income tax type. Xero accepts this identifier verbatim.
export const DEFAULT_TAX_TYPE_OUTPUT = "OUTPUT";
// Default payment term: 14 days from issue. Overridable per customer later.
export const DEFAULT_DUE_DAYS = 7;

// Xero hard-caps LineItem.Description at 4000 chars. Longer scope text must
// be split across multiple description-only rows (see buildScopeInvoiceLines).
export const XERO_DESCRIPTION_LIMIT = 4000;

export interface XeroLineItemInput {
  description: string;
  quantity?: number;       // defaults to 1
  /**
   * ex-GST. Omit entirely for a description-only row — Xero renders those as
   * full-width text lines with blank qty/amount columns, provided quantity,
   * unitAmount and accountCode are ALL absent from the payload.
   */
  unitAmount?: number;
  accountCode?: string;    // defaults to DEFAULT_SALES_ACCOUNT_CODE
  taxType?: string;        // defaults to DEFAULT_TAX_TYPE_OUTPUT
}

/** True when the line carries a charge (description-only rows have no unitAmount). */
export function isPricedLine(li: Pick<XeroLineItemInput, "unitAmount">): boolean {
  return li.unitAmount !== undefined && li.unitAmount !== null;
}

function toXeroLineItem(li: XeroLineItemInput): Record<string, unknown> {
  if (!isPricedLine(li)) {
    // Description-only: sending qty/amount/account would turn it into a $0.00
    // priced row on the PDF, so the description must be the ONLY field.
    return { description: li.description.slice(0, XERO_DESCRIPTION_LIMIT) };
  }
  return {
    description: li.description.slice(0, XERO_DESCRIPTION_LIMIT),
    quantity: li.quantity ?? 1,
    unitAmount: li.unitAmount,
    accountCode: li.accountCode ?? DEFAULT_SALES_ACCOUNT_CODE,
    taxType: li.taxType ?? DEFAULT_TAX_TYPE_OUTPUT,
  };
}

export interface CreateXeroInvoiceInput {
  xero: XeroClient;
  tenantId: string;
  xeroContactId: string;
  lineItems: XeroLineItemInput[];
  reference?: string;      // goes on the invoice header (our quote ref, job number, etc.)
  dueDate?: Date;          // defaults to today + DEFAULT_DUE_DAYS
  /** CRM site name. When the Xero contact isn't named after the site, the
   * Reference becomes "<site> - <reference>" so the site never disappears
   * from the paper (docs/billing-contact-CONTEXT.md D4). */
  siteName?: string | null;
}

export interface CreatedXeroInvoice {
  invoiceID: string;
  invoiceNumber: string | null;
  onlineInvoiceUrl: string | null;
  subTotal: number;
  totalTax: number;
  total: number;
  amountDue: number;
  status: string;
  dueDate: string | null;  // ISO date
  /** Xero contact name at creation — the "Bill to" the customer will see (D5 snapshot). */
  contactName: string | null;
  /** The Reference actually written to Xero (after the D4 site rule). */
  reference: string | null;
}

/**
 * D4: the site must survive on the invoice. When the bill-to contact is the
 * site (the default model) the reference stays as given; when it's a
 * different entity (Bravofit Oxley Pty Ltd, Workspace 360, …) the site name
 * leads the reference. Normalised compare so "Snap Fitness - Preston" still
 * counts as the site.
 */
export function billToReference(
  siteName: string | null | undefined,
  billToName: string | null | undefined,
  reference: string | null | undefined,
): string | null {
  const ref = reference?.trim() || null;
  const site = siteName?.trim();
  if (!site) return ref;
  const norm = (v: string) => v.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const sameEntity = !!billToName && (norm(billToName) === norm(site) || norm(billToName).includes(norm(site)));
  if (sameEntity) return ref;
  if (ref && norm(ref).startsWith(norm(site))) return ref;
  return (ref ? `${site} - ${ref}` : site).slice(0, 255);
}

/** Contact name lookup for the bill-to snapshot; never blocks invoice creation. */
async function contactNameOf(xero: XeroClient, tenantId: string, contactId: string): Promise<string | null> {
  try {
    const res = await xero.accountingApi.getContact(tenantId, contactId);
    return res.body.contacts?.[0]?.name ?? null;
  } catch {
    return null;
  }
}

/**
 * Create a DRAFT sales invoice in Xero. Kept as DRAFT so it does NOT hit the
 * books (A/R, revenue, GST) until Mitchell explicitly authorises it from the
 * CRM. Pay-now link is unavailable on drafts — it gets populated by the
 * authorise endpoint once the invoice is promoted.
 */
export async function createXeroInvoice({
  xero, tenantId, xeroContactId, lineItems, reference, dueDate, siteName,
}: CreateXeroInvoiceInput): Promise<CreatedXeroInvoice> {
  if (lineItems.length === 0) {
    throw new Error("Cannot create a Xero invoice with zero line items");
  }
  if (!lineItems.some(isPricedLine)) {
    throw new Error("Cannot create a Xero invoice with only description-only lines");
  }

  const today = new Date();
  const due = dueDate ?? new Date(today.getTime() + DEFAULT_DUE_DAYS * 86400_000);
  const contactName = await contactNameOf(xero, tenantId, xeroContactId);
  const finalReference = billToReference(siteName, contactName, reference);

  const invoicePayload: Record<string, unknown> = {
    type: "ACCREC", // Accounts Receivable — sales invoice
    status: "DRAFT",
    contact: { contactID: xeroContactId },
    date: brisbaneDateISO(today),
    dueDate: brisbaneDateISO(due),
    lineAmountTypes: "Exclusive", // unit amounts are ex-GST; Xero adds GST
    lineItems: lineItems.map(toXeroLineItem),
  };
  if (finalReference) invoicePayload.reference = finalReference.slice(0, 255);

  const res = await xero.accountingApi.createInvoices(tenantId, {
    invoices: [invoicePayload],
  });
  const invoice = res.body.invoices?.[0];
  if (!invoice?.invoiceID) {
    throw new Error("Xero did not return an InvoiceID for the new invoice");
  }

  return {
    invoiceID: invoice.invoiceID,
    invoiceNumber: invoice.invoiceNumber ?? null,
    onlineInvoiceUrl: null, // drafts have no OnlineInvoiceUrl
    subTotal: Number(invoice.subTotal ?? 0),
    totalTax: Number(invoice.totalTax ?? 0),
    total: Number(invoice.total ?? 0),
    amountDue: Number(invoice.amountDue ?? invoice.total ?? 0),
    status: String(invoice.status ?? "DRAFT"),
    dueDate: invoice.dueDate ?? null,
    contactName: invoice.contact?.name ?? contactName,
    reference: invoice.reference ?? finalReference,
  };
}

/**
 * Re-point an existing invoice at another Xero contact (D3). Xero accepts a
 * Contact + Reference update on DRAFT and on AUTHORISED invoices with no
 * payments (proven 2026-09-16 on INV-6909/6900). Anything else is refused
 * here before we touch Xero. Returns the contact name for the snapshot.
 */
export async function updateXeroInvoiceContact({
  xero, tenantId, xeroInvoiceId, xeroContactId, siteName,
}: {
  xero: XeroClient;
  tenantId: string;
  xeroInvoiceId: string;
  xeroContactId: string;
  siteName?: string | null;
}): Promise<{ contactName: string | null; reference: string | null; status: string }> {
  const current = (await xero.accountingApi.getInvoice(tenantId, xeroInvoiceId)).body.invoices?.[0];
  if (!current) throw new Error("Xero invoice not found");
  const status = String(current.status ?? "");
  if (!(status === "DRAFT" || status === "SUBMITTED" || (status === "AUTHORISED" && Number(current.amountPaid ?? 0) === 0))) {
    throw new Error(`Xero won't let the contact change on a ${status.toLowerCase()} invoice${Number(current.amountPaid ?? 0) > 0 ? " with payments" : ""}`);
  }
  const contactName = await contactNameOf(xero, tenantId, xeroContactId);
  // Strip a previous "<site> - " prefix before re-deriving, so re-pointing
  // twice doesn't stack site names.
  const site = siteName?.trim();
  let baseRef = current.reference ?? null;
  if (site && baseRef && baseRef.toLowerCase().startsWith(`${site.toLowerCase()} - `)) baseRef = baseRef.slice(site.length + 3);
  const reference = billToReference(siteName, contactName, baseRef);
  const payload: Record<string, unknown> = { invoiceID: xeroInvoiceId, contact: { contactID: xeroContactId } };
  if (reference !== null) payload.reference = reference;
  const res = await xero.accountingApi.updateInvoice(tenantId, xeroInvoiceId, { invoices: [payload] });
  const updated = res.body.invoices?.[0];
  if (updated?.contact?.contactID && updated.contact.contactID !== xeroContactId) {
    throw new Error("Xero did not apply the contact change");
  }
  return { contactName: updated?.contact?.name ?? contactName, reference: updated?.reference ?? reference, status: String(updated?.status ?? status) };
}

/**
 * Replace the line items on a DRAFT Xero invoice. Xero's updateInvoice
 * replaces the lineItems array wholesale when one is supplied — there's no
 * partial-update path, so the caller must send the full new set. Returns
 * Xero's recomputed totals so the CRM mirror stays in sync.
 *
 * Only valid for DRAFT invoices — Xero rejects line-item changes on
 * authorised/paid invoices. The caller must enforce that gate.
 */
export async function updateXeroInvoiceLines({
  xero,
  tenantId,
  xeroInvoiceId,
  lineItems,
}: {
  xero: XeroClient;
  tenantId: string;
  xeroInvoiceId: string;
  lineItems: XeroLineItemInput[];
}): Promise<{
  subTotal: number;
  totalTax: number;
  total: number;
  amountDue: number;
  status: string;
}> {
  if (lineItems.length === 0) {
    throw new Error("Cannot update Xero invoice to zero line items");
  }
  if (!lineItems.some(isPricedLine)) {
    throw new Error("Cannot update Xero invoice to only description-only lines");
  }
  const res = await xero.accountingApi.updateInvoice(tenantId, xeroInvoiceId, {
    invoices: [
      {
        lineAmountTypes: "Exclusive",
        lineItems: lineItems.map(toXeroLineItem),
      } as Record<string, unknown>,
    ],
  });
  const invoice = res.body.invoices?.[0];
  if (!invoice) throw new Error("Xero did not return an invoice on update");
  return {
    subTotal: Number(invoice.subTotal ?? 0),
    totalTax: Number(invoice.totalTax ?? 0),
    total: Number(invoice.total ?? 0),
    amountDue: Number(invoice.amountDue ?? invoice.total ?? 0),
    status: String(invoice.status ?? "DRAFT"),
  };
}

/**
 * Fetch the OnlineInvoiceUrl (pay-now link) for an invoice. Only exists for
 * AUTHORISED/PAID invoices — Xero has no online view of drafts. The CRM only
 * stores this at authorise time, so invoices that entered via Xero-side sync
 * (legacy imports, webhook, backfills) have a null xero_online_url until a
 * send/reminder flow backfills it with this call.
 */
export async function fetchXeroOnlineInvoiceUrl(
  xero: XeroClient,
  tenantId: string,
  xeroInvoiceId: string,
): Promise<string | null> {
  const online = await xero.accountingApi.getOnlineInvoice(tenantId, xeroInvoiceId);
  return online.body.onlineInvoices?.[0]?.onlineInvoiceUrl ?? null;
}

/**
 * Download the invoice PDF exactly as Xero renders it — branding theme, bank
 * details and all — for attaching to our Resend emails.
 */
export async function fetchXeroInvoicePdf(
  xero: XeroClient,
  tenantId: string,
  xeroInvoiceId: string,
): Promise<Buffer> {
  const res = await xero.accountingApi.getInvoiceAsPdf(tenantId, xeroInvoiceId, {
    headers: { accept: "application/pdf" },
  });
  return res.body;
}

/**
 * Promote a DRAFT invoice to AUTHORISED and fetch the resulting
 * OnlineInvoiceUrl (pay-now link). Called from the CRM's Authorise button.
 */
export async function authoriseXeroInvoice(
  xero: XeroClient,
  tenantId: string,
  xeroInvoiceId: string,
): Promise<{ onlineInvoiceUrl: string | null; status: string }> {
  const res = await xero.accountingApi.updateInvoice(tenantId, xeroInvoiceId, {
    invoices: [{ status: "AUTHORISED" } as Record<string, unknown>],
  });
  const invoice = res.body.invoices?.[0];
  const status = String(invoice?.status ?? "AUTHORISED");

  let onlineUrl: string | null = null;
  try {
    onlineUrl = await fetchXeroOnlineInvoiceUrl(xero, tenantId, xeroInvoiceId);
  } catch {
    // Not fatal — invoice is authorised; Mitchell can grab the URL from Xero.
  }
  return { onlineInvoiceUrl: onlineUrl, status };
}

/**
 * Mark a Xero invoice as "sent" (SentToContact=true) WITHOUT emailing through
 * Xero. We email the customer with our own branded template (Resend), then flip
 * this flag so Xero's UI shows the invoice as Sent for tracking/reconciliation.
 *
 * Best-effort: callers should not fail the user-facing send if this errors —
 * the customer still got the email; only Xero's flag is out of sync.
 */
export async function markXeroInvoiceSent(
  xero: XeroClient,
  tenantId: string,
  xeroInvoiceId: string,
): Promise<void> {
  await xero.accountingApi.updateInvoice(tenantId, xeroInvoiceId, {
    invoices: [{ sentToContact: true } as Record<string, unknown>],
  });
}

/**
 * Pull the latest state of a Xero invoice (for refreshing payment status).
 */
export async function fetchXeroInvoice(
  xero: XeroClient,
  tenantId: string,
  xeroInvoiceId: string,
): Promise<{
  amountDue: number;
  amountPaid: number;
  total: number;
  status: string;
  fullyPaidOnDate: string | null;
  invoiceNumber: string | null;
  contactID: string | null;
  /** Bill-to name as Xero holds it now (D5 snapshot source). */
  contactName: string | null;
  reference: string | null;
  dueDate: string | null;
  /** Set when Xero auto-generated this invoice from a RepeatingInvoice template. */
  repeatingInvoiceID: string | null;
}> {
  const res = await xero.accountingApi.getInvoice(tenantId, xeroInvoiceId);
  const invoice = res.body.invoices?.[0];
  if (!invoice) throw new Error("Xero invoice not found");

  return {
    amountDue: Number(invoice.amountDue ?? 0),
    amountPaid: Number(invoice.amountPaid ?? 0),
    total: Number(invoice.total ?? 0),
    status: String(invoice.status ?? "UNKNOWN"),
    fullyPaidOnDate: invoice.fullyPaidOnDate ?? null,
    invoiceNumber: invoice.invoiceNumber ?? null,
    contactID: invoice.contact?.contactID ?? null,
    contactName: invoice.contact?.name ?? null,
    reference: invoice.reference ?? null,
    dueDate: invoice.dueDate ?? null,
    repeatingInvoiceID: invoice.repeatingInvoiceID ?? null,
  };
}

/**
 * Standing headline that prefixes every Centrefit invoice line. The detailed
 * scope of works lives below it as the "description".
 */
export const INVOICE_LINE_HEADLINE = "Supply, install & commission as per Scope of Works";

export interface ScopeDescriptionOptions {
  /** "Site: Foo Gym — 123 Main St…" — already includes trailing newlines. */
  siteHeader?: string;
  /** Milestone label for progress invoices, e.g. "Progress Payment 1 — On Acceptance". */
  milestoneHeader?: string;
  roleDescriptions?: Record<string, string>;
  /**
   * Manual-quote scope text. When provided, the BOM-driven scope generator
   * is skipped entirely and this text is used verbatim as the invoice line
   * body — matching the scope the customer accepted on the quote.
   */
  manualScopeText?: string;
}

/**
 * Render the merged Scope of Works as a line-item description, headed by the
 * standard "Supply, install & commission…" line so the description reads as:
 *   <headline>
 *   <site header>
 *   <milestone (if any)>
 *   <SoW body>
 */
export function formatScopeDescription(
  bom: BOMLineForScope[],
  products: ProductForScope[],
  siteInfo: SiteInfo,
  overrides: ScopeOverrides | null | undefined,
  opts: ScopeDescriptionOptions = {},
): string {
  const manualText = opts.manualScopeText?.trim();
  const scope = manualText
    ? manualScopeDocument(manualText)
    : generateScopeOfWorks(bom, products, siteInfo, overrides ?? undefined, opts.roleDescriptions);
  const body = renderScopeAsText(scope);
  const parts: string[] = [INVOICE_LINE_HEADLINE];
  if (opts.siteHeader) parts.push(opts.siteHeader.replace(/\n+$/, ''));
  if (opts.milestoneHeader) parts.push(opts.milestoneHeader);
  parts.push(body);
  return parts.join('\n\n');
}

/**
 * Split long text into chunks that each fit Xero's per-line description
 * limit, breaking on line boundaries so no sentence is cut mid-word. A single
 * line longer than the limit (no natural break) is hard-split at the last
 * space before the limit.
 */
export function chunkDescription(text: string, limit = XERO_DESCRIPTION_LIMIT): string[] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  if (trimmed.length <= limit) return [trimmed];

  const chunks: string[] = [];
  let current = "";
  for (const line of trimmed.split("\n")) {
    let piece = line;
    while (piece.length > limit) {
      const lastSpace = piece.lastIndexOf(" ", limit);
      const cut = lastSpace > limit * 0.5 ? lastSpace : limit;
      if (current) {
        chunks.push(current);
        current = "";
      }
      chunks.push(piece.slice(0, cut).trimEnd());
      piece = piece.slice(cut).trimStart();
    }
    const candidate = current ? `${current}\n${piece}` : piece;
    if (candidate.length > limit) {
      chunks.push(current);
      current = piece;
    } else {
      current = candidate;
    }
  }
  if (current.trim()) chunks.push(current);
  return chunks;
}

/**
 * Build the line set for a scope-of-works invoice: the FULL scope text as
 * description-only rows (split across as many rows as Xero's 4000-char limit
 * requires — nothing is truncated), followed by a single priced line carrying
 * the charge. This is what fixes long quotes getting their scope chopped when
 * everything lived on the one priced line.
 */
export function buildScopeInvoiceLines(
  scopeText: string,
  pricedDescription: string,
  amount: number,
): XeroLineItemInput[] {
  return [
    ...chunkDescription(scopeText).map((description) => ({ description })),
    { description: pricedDescription, quantity: 1, unitAmount: amount },
  ];
}

/**
 * Reference-only invoice line (Mitchell's call, 2026-07-16): the accepted
 * quote is the scope document, so the invoice carries ONE clean priced line
 * referencing it instead of repeating the scope of works. Customers who need
 * the detail have the accepted quote; head offices get the quote PDF.
 */
export function buildQuoteReferenceLine(opts: {
  quoteRef: string;
  amount: number;
  /** "Site: Foo Gym — 123 Main St…" */
  siteHeader?: string;
  /** e.g. "Progress Payment 1 (on acceptance)" — omit for full invoices. */
  milestone?: string;
}): XeroLineItemInput[] {
  const headline = opts.milestone
    ? `${opts.milestone} — as per accepted Quote ${opts.quoteRef}`
    : `Supply, install & commission as per accepted Quote ${opts.quoteRef}`;
  const description = [headline, opts.siteHeader?.replace(/\n+$/, "")]
    .filter(Boolean)
    .join("\n");
  return [{ description, quantity: 1, unitAmount: opts.amount }];
}
