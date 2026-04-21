import type { XeroClient } from "xero-node";
import { generateScopeOfWorks, type ScopeOverrides, type SiteInfo } from "@/lib/quote-engine";

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
 * Create an AUTHORISED (not DRAFT) sales invoice in Xero. AUTHORISED is
 * required to get an `OnlineInvoiceUrl` we can send to the customer.
 *
 * Returns a normalised shape the API route can persist directly.
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
    status: "AUTHORISED",
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

  // Fetch the OnlineInvoiceUrl — Xero exposes it on a separate endpoint.
  let onlineUrl: string | null = null;
  try {
    const online = await xero.accountingApi.getOnlineInvoice(
      tenantId,
      invoice.invoiceID,
    );
    onlineUrl = online.body.onlineInvoices?.[0]?.onlineInvoiceUrl ?? null;
  } catch {
    // Not fatal — the invoice still exists; Mitchell can grab the URL from Xero.
  }

  return {
    invoiceID: invoice.invoiceID,
    invoiceNumber: invoice.invoiceNumber ?? null,
    onlineInvoiceUrl: onlineUrl,
    subTotal: Number(invoice.subTotal ?? 0),
    totalTax: Number(invoice.totalTax ?? 0),
    total: Number(invoice.total ?? 0),
    amountDue: Number(invoice.amountDue ?? invoice.total ?? 0),
    status: String(invoice.status ?? "AUTHORISED"),
    dueDate: invoice.dueDate ?? null,
  };
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
  deviceCounts: Record<string, number>,
  siteInfo: SiteInfo,
  overrides: ScopeOverrides | null | undefined,
  prefix?: string,
): string {
  const scope = generateScopeOfWorks(deviceCounts, siteInfo, overrides ?? undefined);

  const parts: string[] = [];
  if (prefix) parts.push(prefix, "");

  for (const section of scope.sections) {
    const visible = section.items.filter((i) => i.included && i.text.trim());
    if (visible.length === 0) continue;
    parts.push(`${section.heading}:`);
    for (const item of visible) parts.push(`  • ${item.text}`);
    parts.push("");
  }

  const visibleNotes = scope.notes.filter((n) => n.included && n.text.trim());
  if (visibleNotes.length > 0) {
    parts.push("PLEASE NOTE:");
    for (const note of visibleNotes) parts.push(`  • ${note.text}`);
  }

  return parts.join("\n").trim();
}
