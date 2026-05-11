import "server-only";
import { XeroClient } from "xero-node";

/**
 * Xero RepeatingInvoice wrapper.
 *
 * Centrefit uses RepeatingInvoices to automate the recurring side of
 * billing — once a customer's GoCardless mandate is active, we create one
 * RepeatingInvoice template per plan. Xero then auto-generates child
 * invoices on the schedule and (because the contact is linked to the GC
 * mandate via the AUD clearing account) auto-debits each invoice as it
 * becomes due.
 *
 * Xero's Schedule.UnitEnum only supports WEEKLY / MONTHLY. We map yearly
 * cadence to `unit: MONTHLY, period: 12`.
 */

export type PlanFrequency = "monthly" | "yearly";

export interface RepeatingInvoiceLineInput {
  description: string;
  quantity?: number;
  unitAmount: number;        // GST-inclusive price as we hold it in catalogue
  accountCode?: string;
  taxType?: string;
}

export interface CreateRepeatingInvoiceInput {
  xero: XeroClient;
  tenantId: string;
  xeroContactId: string;
  /** Reference field on each child invoice (e.g. plan ID or human ref). */
  reference?: string;
  /** Frequency of generation. Yearly maps to MONTHLY × 12. */
  frequency: PlanFrequency;
  /** ISO date (YYYY-MM-DD) for the first auto-generated invoice. */
  nextScheduledDate: string;
  /** Optional ISO end date — defaults to open-ended. */
  endDate?: string;
  /** Days after invoice date for due. Centrefit default is 7. */
  dueDays?: number;
  lineItems: RepeatingInvoiceLineInput[];
  /** "DRAFT" | "AUTHORISED" — auto-generated children inherit this status. */
  childStatus?: "DRAFT" | "AUTHORISED";
}

export interface CreatedRepeatingInvoice {
  repeatingInvoiceID: string;
  status: string;
  nextScheduledDate: string | null;
}

const DEFAULT_SALES_ACCOUNT_CODE = "200";   // matches createXeroInvoice default
const DEFAULT_TAX_TYPE_INCLUSIVE = "OUTPUT"; // GST inclusive line items

/**
 * Create a Xero RepeatingInvoice template. Returns the new template's ID.
 *
 * lineAmountTypes is set to "Inclusive" because our catalogue prices are
 * stored GST-inclusive (Mitchell confirmed 2026-04-28).
 */
export async function createRepeatingInvoice(
  input: CreateRepeatingInvoiceInput,
): Promise<CreatedRepeatingInvoice> {
  const {
    xero, tenantId, xeroContactId, frequency, nextScheduledDate,
    endDate, lineItems, reference, dueDays = 7, childStatus = "AUTHORISED",
  } = input;

  if (lineItems.length === 0) {
    throw new Error("Cannot create a RepeatingInvoice with zero line items");
  }

  const period = frequency === "yearly" ? 12 : 1;

  const payload: Record<string, unknown> = {
    type: "ACCREC",
    status: childStatus,
    contact: { contactID: xeroContactId },
    schedule: {
      period,
      unit: "MONTHLY",
      dueDate: dueDays,
      dueDateType: "DAYSAFTERBILLDATE",
      nextScheduledDate,
      ...(endDate ? { endDate } : {}),
    },
    lineAmountTypes: "Inclusive",
    lineItems: lineItems.map((li) => ({
      description: li.description.slice(0, 4000),
      quantity: li.quantity ?? 1,
      unitAmount: li.unitAmount,
      accountCode: li.accountCode ?? DEFAULT_SALES_ACCOUNT_CODE,
      taxType: li.taxType ?? DEFAULT_TAX_TYPE_INCLUSIVE,
    })),
  };
  if (reference) payload.reference = reference.slice(0, 255);

  const res = await xero.accountingApi.createRepeatingInvoices(tenantId, {
    repeatingInvoices: [payload as never],
  });
  const ri = res.body.repeatingInvoices?.[0];
  if (!ri?.repeatingInvoiceID) {
    throw new Error("Xero did not return a RepeatingInvoiceID");
  }
  return {
    repeatingInvoiceID: ri.repeatingInvoiceID,
    status: String(ri.status ?? childStatus),
    nextScheduledDate: ri.schedule?.nextScheduledDate ?? null,
  };
}

/**
 * Cancel a RepeatingInvoice template by setting it to DELETED. Children
 * already generated keep their state in Xero.
 */
export async function cancelRepeatingInvoice(
  xero: XeroClient,
  tenantId: string,
  repeatingInvoiceId: string,
): Promise<void> {
  await xero.accountingApi.updateRepeatingInvoice(tenantId, repeatingInvoiceId, {
    repeatingInvoices: [{ status: "DELETED" } as never],
  });
}

/**
 * Update an existing RepeatingInvoice template's line items in place. The
 * schedule (period, unit, nextScheduledDate, dueDays) is preserved by Xero
 * — sending only `lineItems` is a partial update, not a full replace. Used
 * by the plan-edit flow when a customer adds or removes services from an
 * already-active plan: the next auto-generated child invoice fires with
 * the new lines, but the cadence and run dates don't reset.
 */
export async function updateRepeatingInvoiceLines(
  xero: XeroClient,
  tenantId: string,
  repeatingInvoiceId: string,
  lineItems: RepeatingInvoiceLineInput[],
): Promise<void> {
  if (lineItems.length === 0) {
    throw new Error("Cannot update a RepeatingInvoice to zero line items — cancel it instead");
  }
  await xero.accountingApi.updateRepeatingInvoice(tenantId, repeatingInvoiceId, {
    repeatingInvoices: [
      {
        lineItems: lineItems.map((li) => ({
          description: li.description.slice(0, 4000),
          quantity: li.quantity ?? 1,
          unitAmount: li.unitAmount,
          accountCode: li.accountCode ?? DEFAULT_SALES_ACCOUNT_CODE,
          taxType: li.taxType ?? DEFAULT_TAX_TYPE_INCLUSIVE,
        })),
      } as never,
    ],
  });
}
