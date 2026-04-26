import type { XeroClient } from "xero-node";
import {
  generateScopeOfWorks,
  renderScopeAsText,
  type ScopeOverrides,
  type SiteInfo,
  type BOMLineForScope,
  type ProductForScope,
} from "@/lib/quote-engine";

// Centrefit's default Xero sales account code. Sue used 200 historically —
// if this ever changes, update here + let the rest of the code flow through.
export const DEFAULT_SALES_ACCOUNT_CODE = "200";
// Australian GST on income tax type. Xero accepts this identifier verbatim.
export const DEFAULT_TAX_TYPE_OUTPUT = "OUTPUT";
// Default payment term: 14 days from issue. Overridable per customer later.
export const DEFAULT_DUE_DAYS = 14;

export interface XeroLineItemInput {
  description: string;
  quantity?: number;       // defaults to 1
  unitAmount: number;      // ex-GST
  accountCode?: string;    // defaults to DEFAULT_SALES_ACCOUNT_CODE
  taxType?: string;        // defaults to DEFAULT_TAX_TYPE_OUTPUT
}

export interface CreateXeroInvoiceInput {
  xero: XeroClient;
  tenantId: string;
  xeroContactId: string;
  lineItems: XeroLineItemInput[];
  reference?: string;      // goes on the invoice header (our quote ref, job number, etc.)
  dueDate?: Date;          // defaults to today + DEFAULT_DUE_DAYS
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
}

/**
 * Create a DRAFT sales invoice in Xero. Kept as DRAFT so it does NOT hit the
 * books (A/R, revenue, GST) until Mitchell explicitly authorises it from the
 * CRM. Pay-now link is unavailable on drafts — it gets populated by the
 * authorise endpoint once the invoice is promoted.
 */
export async function createXeroInvoice({
  xero, tenantId, xeroContactId, lineItems, reference, dueDate,
}: CreateXeroInvoiceInput): Promise<CreatedXeroInvoice> {
  if (lineItems.length === 0) {
    throw new Error("Cannot create a Xero invoice with zero line items");
  }

  const today = new Date();
  const due = dueDate ?? new Date(today.getTime() + DEFAULT_DUE_DAYS * 86400_000);

  const invoicePayload: Record<string, unknown> = {
    type: "ACCREC", // Accounts Receivable — sales invoice
    status: "DRAFT",
    contact: { contactID: xeroContactId },
    date: today.toISOString().slice(0, 10),
    dueDate: due.toISOString().slice(0, 10),
    lineAmountTypes: "Exclusive", // unit amounts are ex-GST; Xero adds GST
    lineItems: lineItems.map((li) => ({
      description: li.description.slice(0, 4000), // Xero limit
      quantity: li.quantity ?? 1,
      unitAmount: li.unitAmount,
      accountCode: li.accountCode ?? DEFAULT_SALES_ACCOUNT_CODE,
      taxType: li.taxType ?? DEFAULT_TAX_TYPE_OUTPUT,
    })),
  };
  if (reference) invoicePayload.reference = reference.slice(0, 255);

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
  };
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
    const online = await xero.accountingApi.getOnlineInvoice(tenantId, xeroInvoiceId);
    onlineUrl = online.body.onlineInvoices?.[0]?.onlineInvoiceUrl ?? null;
  } catch {
    // Not fatal — invoice is authorised; Mitchell can grab the URL from Xero.
  }
  return { onlineInvoiceUrl: onlineUrl, status };
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
  status: string;
  fullyPaidOnDate: string | null;
}> {
  const res = await xero.accountingApi.getInvoice(tenantId, xeroInvoiceId);
  const invoice = res.body.invoices?.[0];
  if (!invoice) throw new Error("Xero invoice not found");

  return {
    amountDue: Number(invoice.amountDue ?? 0),
    amountPaid: Number(invoice.amountPaid ?? 0),
    status: String(invoice.status ?? "UNKNOWN"),
    fullyPaidOnDate: invoice.fullyPaidOnDate ?? null,
  };
}

/**
 * Render the merged Scope of Works as a line-item description. Sections are
 * headered ("ROUGH IN:" / "FIT OFF:"); clauses are bulleted. Notes are tacked
 * on under a "PLEASE NOTE" header. Matches how Mitchell reads the SoW in the
 * preview — keeps the invoice description aligned with what the customer saw
 * at quote time.
 */
export function formatScopeDescription(
  bom: BOMLineForScope[],
  products: ProductForScope[],
  siteInfo: SiteInfo,
  overrides: ScopeOverrides | null | undefined,
  prefix?: string,
  roleDescriptions?: Record<string, string>,
): string {
  const scope = generateScopeOfWorks(bom, products, siteInfo, overrides ?? undefined, roleDescriptions);
  const body = renderScopeAsText(scope);
  return prefix ? `${prefix}\n\n${body}` : body;
}
