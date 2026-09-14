import type { XeroClient } from "xero-node";
import { brisbaneDateISO } from "@/lib/dates";

// The Xero account every PO line is coded to. Centrefit's chart has no
// generic "300 Purchases" any more (deleted in the September 2026 chart
// tidy-up, which broke PO generation with "account code is not valid");
// parts bought for jobs go to 341 "Purchase - IT Parts", the same account the
// Xero Items and the hand-made POs use. Override with XERO_PURCHASE_ACCOUNT_CODE
// if the bookkeeper moves it again; generate-pos checks the code exists and
// is active before it tries to create anything.
export const DEFAULT_PURCHASE_ACCOUNT_CODE =
  process.env.XERO_PURCHASE_ACCOUNT_CODE?.trim() || "341";
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
  idempotencyKey?: string;  // dedupes retries/double-clicks at Xero (24h window)
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
  idempotencyKey,
}: CreateXeroPOInput): Promise<CreatedXeroPO> {
  if (lineItems.length === 0) {
    throw new Error("Cannot create a Xero PO with zero line items");
  }

  const issueDate = brisbaneDateISO(date ?? new Date());

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

  const create = (key?: string) =>
    xero.accountingApi.createPurchaseOrders(
      tenantId,
      { purchaseOrders: [poPayload] },
      true, // summarizeErrors
      key,
    );

  let res: Awaited<ReturnType<typeof create>>;
  try {
    res = await create(idempotencyKey);
  } catch (err) {
    if (!idempotencyKey || !isIdempotencyConflict(err)) throw err;
    // "Idempotency Key … is used with a different request": the same key was
    // first sent with a payload that has since changed (2026-09-14: the same
    // rows, but account 300 → 341 and a merged supplier contact after the
    // Xero tidy). Xero remembers a key for 24h even when that first request
    // FAILED. If the earlier request did make a PO, adopt it rather than
    // duplicate; otherwise go again with a fresh key.
    const existing = await findTodaysDraft(xero, tenantId, supplierContactId, reference, lineItems.length, issueDate);
    if (existing) return existing;
    res = await create(`${idempotencyKey}-${Date.now().toString(36)}`);
  }
  let po = res.body.purchaseOrders?.[0];
  if (!po?.purchaseOrderID) {
    throw new Error("Xero did not return a PurchaseOrderID for the new PO");
  }

  // Xero idempotency replays the ORIGINAL response for 24h. If the earlier PO
  // was deleted since (the reset flow), the replay hands back a dead PO with a
  // healthy-looking DRAFT status — verify live state and retry once with a
  // fresh key so the rows never get linked to a deleted PO.
  if (idempotencyKey) {
    const live = await xero.accountingApi.getPurchaseOrder(tenantId, po.purchaseOrderID);
    const liveStatus = String(live.body.purchaseOrders?.[0]?.status ?? "");
    if (liveStatus === "DELETED") {
      const retry = await xero.accountingApi.createPurchaseOrders(
        tenantId,
        { purchaseOrders: [poPayload] },
        true,
        `${idempotencyKey}-${Date.now().toString(36)}`,
      );
      po = retry.body.purchaseOrders?.[0];
      if (!po?.purchaseOrderID) {
        throw new Error("Xero did not return a PurchaseOrderID on the post-delete retry");
      }
    }
  }

  return {
    purchaseOrderID: po.purchaseOrderID,
    purchaseOrderNumber: po.purchaseOrderNumber ?? null,
    total: Number(po.total ?? 0),
    status: String(po.status ?? "DRAFT"),
  };
}

function isIdempotencyConflict(err: unknown): boolean {
  const body = (err as { response?: { body?: { Detail?: unknown } } })?.response?.body;
  const detail = typeof body?.Detail === "string" ? body.Detail : "";
  return /idempotency key/i.test(detail) && /different request/i.test(detail);
}

/**
 * A DRAFT PO created today for this supplier + job reference with the same
 * number of lines — what an earlier attempt would have left behind if Xero
 * made the PO but the CRM never heard back. Newest wins.
 */
async function findTodaysDraft(
  xero: XeroClient,
  tenantId: string,
  supplierContactId: string,
  reference: string | undefined,
  lineCount: number,
  issueDate: string,
): Promise<CreatedXeroPO | null> {
  try {
    const res = await xero.accountingApi.getPurchaseOrders(
      tenantId,
      undefined,
      "DRAFT",
      issueDate,
      issueDate,
      "UpdatedDateUTC DESC",
    );
    const match = (res.body.purchaseOrders ?? []).find(
      (p) =>
        p.contact?.contactID === supplierContactId &&
        (p.reference ?? "") === (reference ?? "") &&
        (p.lineItems?.length ?? 0) === lineCount &&
        !!p.purchaseOrderID,
    );
    if (!match?.purchaseOrderID) return null;
    return {
      purchaseOrderID: match.purchaseOrderID,
      purchaseOrderNumber: match.purchaseOrderNumber ?? null,
      total: Number(match.total ?? 0),
      status: String(match.status ?? "DRAFT"),
    };
  } catch {
    return null; // can't tell — fall through to a fresh create
  }
}

/**
 * Delete a DRAFT purchase order in Xero (sets status DELETED). Used by the
 * "reset PO" action so staff can undo a mistaken Generate POs and re-triage.
 *
 * Only DRAFT/SUBMITTED POs can be deleted — a PO that's been BILLED can't be
 * unwound this way. Xero returns an error in that case, which we surface.
 */
export async function deleteXeroPurchaseOrder({
  xero,
  tenantId,
  purchaseOrderID,
}: {
  xero: XeroClient;
  tenantId: string;
  purchaseOrderID: string;
}): Promise<void> {
  await xero.accountingApi.updatePurchaseOrder(tenantId, purchaseOrderID, {
    purchaseOrders: [{ status: "DELETED" } as Record<string, unknown>],
  } as never);
}
