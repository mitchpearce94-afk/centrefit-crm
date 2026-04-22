import type { XeroClient } from "xero-node";

// Xero's default Cost of Sales account in the standard chart.
// Centrefit uses 300 historically — override per-line if a particular
// product maps elsewhere.
export const DEFAULT_PURCHASE_ACCOUNT_CODE = "300";
// Australian GST on expenses. Input-only tax.
export const DEFAULT_TAX_TYPE_INPUT = "INPUT";

export interface XeroPOLineItem {
  description: string;
  quantity?: number;       // defaults to 1
  unitAmount?: number;     // ex-GST. Defaults to 0 so staff can edit in Xero.
  accountCode?: string;    // defaults to DEFAULT_PURCHASE_ACCOUNT_CODE
  taxType?: string;        // defaults to DEFAULT_TAX_TYPE_INPUT
  itemCode?: string;       // Xero Item Code (SKU) if the product has been synced
}

export interface CreateXeroPOInput {
  xero: XeroClient;
  tenantId: string;
  supplierContactId: string;
  lineItems: XeroPOLineItem[];
  reference?: string;       // goes on the PO header — e.g. job number
  deliveryAddress?: string; // site address
  deliveryInstructions?: string;
  date?: Date;              // PO issue date, defaults to today
}

export interface CreatedXeroPO {
  purchaseOrderID: string;
  purchaseOrderNumber: string | null;
  total: number;
  status: string;
}

/**
 * Create a DRAFT purchase order in Xero. DRAFT status means Mitchell reviews
 * and sends from Xero — human-in-loop, matching the invoicing pattern.
 */
export async function createXeroPurchaseOrder({
  xero,
  tenantId,
  supplierContactId,
  lineItems,
  reference,
  deliveryAddress,
  deliveryInstructions,
  date,
}: CreateXeroPOInput): Promise<CreatedXeroPO> {
  if (lineItems.length === 0) {
    throw new Error("Cannot create a Xero PO with zero line items");
  }

  const issueDate = (date ?? new Date()).toISOString().slice(0, 10);

  const poPayload: Record<string, unknown> = {
    status: "DRAFT",
    contact: { contactID: supplierContactId },
    date: issueDate,
    lineAmountTypes: "Exclusive",
    lineItems: lineItems.map((li) => {
      const line: Record<string, unknown> = {
        description: li.description.slice(0, 4000),
        quantity: li.quantity ?? 1,
        unitAmount: li.unitAmount ?? 0,
        accountCode: li.accountCode ?? DEFAULT_PURCHASE_ACCOUNT_CODE,
        taxType: li.taxType ?? DEFAULT_TAX_TYPE_INPUT,
      };
      if (li.itemCode) line.itemCode = li.itemCode;
      return line;
    }),
  };
  if (reference) poPayload.reference = reference.slice(0, 255);
  if (deliveryAddress) poPayload.deliveryAddress = deliveryAddress.slice(0, 500);
  if (deliveryInstructions) {
    poPayload.deliveryInstructions = deliveryInstructions.slice(0, 500);
  }

  const res = await xero.accountingApi.createPurchaseOrders(tenantId, {
    purchaseOrders: [poPayload],
  });
  const po = res.body.purchaseOrders?.[0];
  if (!po?.purchaseOrderID) {
    throw new Error("Xero did not return a PurchaseOrderID for the new PO");
  }

  return {
    purchaseOrderID: po.purchaseOrderID,
    purchaseOrderNumber: po.purchaseOrderNumber ?? null,
    total: Number(po.total ?? 0),
    status: String(po.status ?? "DRAFT"),
  };
}
