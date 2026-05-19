import "server-only";
import crypto from "node:crypto";
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
  /**
   * ISO date (YYYY-MM-DD) for the FIRST auto-generated invoice. This maps
   * to Xero's `Schedule.StartDate` field. `NextScheduledDate` is computed
   * by Xero from this — sending only `NextScheduledDate` (which is what
   * we did before 2026-05-11) caused Xero to ignore our future date and
   * default StartDate to today, firing the first invoice immediately.
   */
  startDate: string;
  /** Optional ISO end date — defaults to open-ended. */
  endDate?: string;
  /** Days after invoice date for due. Centrefit default is 7. */
  dueDays?: number;
  lineItems: RepeatingInvoiceLineInput[];
  /**
   * Status the auto-generated children inherit.
   * DEFAULT: "DRAFT". Hard rule from 2026-05-11 — never default to
   * AUTHORISED here because Xero's org-level "auto-send when authorised"
   * setting will email customers without further confirmation. AUTHORISED
   * is opt-in only and must be paired with Mitchell's explicit sign-off.
   */
  childStatus?: "DRAFT" | "AUTHORISED";
  /**
   * Xero Branding Theme GUID. Controls the PDF layout, logo, colours,
   * payment block, and the default email body that gets sent with the
   * invoice. Centrefit has two themes:
   *   - "Centrefit Communications DD" (NBN-derived plans)
   *   - "Centrefit Solutions DD" (everything else)
   * Caller decides which one to pass based on plan provenance.
   */
  brandingThemeID?: string;
  /**
   * Attach the invoice PDF to the auto-send email. Default true so Mitchell's
   * customers get the PDF in their inbox rather than only a "view online"
   * link. Maps to the "Attach PDF" tickbox on each RI in the Xero UI.
   */
  includePDF?: boolean;
  /**
   * Idempotency key sent to Xero. When the SDK retries on 429, the retry
   * reuses the same body — without this key, each retry creates a duplicate
   * RepeatingInvoice on Xero's side while only the LAST response is seen
   * here. We discovered this the hard way on 2026-05-11. Default: random
   * UUID per call (so retries dedupe but new calls don't collide).
   */
  idempotencyKey?: string;
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
    xero, tenantId, xeroContactId, frequency, startDate,
    endDate, lineItems, reference, dueDays = 7, childStatus = "DRAFT",
    brandingThemeID,
    includePDF = true,
    idempotencyKey = crypto.randomUUID(),
  } = input;

  // Pre-approve auto-generated children for sending so once Mitchell flips
  // the template from DRAFT → AUTHORISED (one click in the Xero UI), every
  // child fires on schedule AND auto-emails the customer in the same shot.
  // Locked in 2026-05-12 after Mitchell confirmed the desired flow:
  // "approve once, runs forever".

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
      // StartDate is the writable "first invoice fires on" field.
      // NextScheduledDate is normally Xero-computed; mirror it to startDate
      // belt-and-braces so there's no ambiguity on creation.
      startDate,
      nextScheduledDate: startDate,
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
  if (brandingThemeID) payload.brandingThemeID = brandingThemeID;
  payload.includePDF = includePDF;
  payload.approvedForSending = true;

  const res = await xero.accountingApi.createRepeatingInvoices(
    tenantId,
    { repeatingInvoices: [payload as never] },
    undefined,
    idempotencyKey,
  );
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
 * Read-only fetch of a RepeatingInvoice template. Used by the admin
 * status-check endpoint to verify what Xero actually has on file for a
 * plan (status, next-scheduled-date, branding theme, line count) without
 * touching any customer-facing state.
 */
export interface RepeatingInvoiceState {
  repeatingInvoiceID: string;
  status: string;                    // DRAFT | AUTHORISED | DELETED
  reference: string | null;
  scheduleUnit: string | null;
  schedulePeriod: number | null;
  startDate: string | null;
  nextScheduledDate: string | null;
  endDate: string | null;
  dueDays: number | null;
  dueDateType: string | null;
  brandingThemeID: string | null;
  approvedForSending: boolean | null;
  includePDF: boolean | null;
  lineItemCount: number;
  total: number | null;
}

export async function getRepeatingInvoice(
  xero: XeroClient,
  tenantId: string,
  repeatingInvoiceId: string,
): Promise<RepeatingInvoiceState> {
  const res = await xero.accountingApi.getRepeatingInvoice(tenantId, repeatingInvoiceId);
  const ri = res.body.repeatingInvoices?.[0];
  if (!ri) throw new Error(`Xero returned no RepeatingInvoice for ${repeatingInvoiceId}`);
  // SDK types use lowercase keys here.
  const sched = (ri.schedule ?? {}) as Record<string, unknown>;
  return {
    repeatingInvoiceID: ri.repeatingInvoiceID ?? repeatingInvoiceId,
    status: String(ri.status ?? "UNKNOWN"),
    reference: (ri.reference ?? null) as string | null,
    scheduleUnit: (sched.unit ?? null) as string | null,
    schedulePeriod: (sched.period ?? null) as number | null,
    startDate: (sched.startDate ?? null) as string | null,
    nextScheduledDate: (sched.nextScheduledDate ?? null) as string | null,
    endDate: (sched.endDate ?? null) as string | null,
    dueDays: (sched.dueDate ?? null) as number | null,
    dueDateType: (sched.dueDateType ?? null) as string | null,
    brandingThemeID: (ri.brandingThemeID ?? null) as string | null,
    approvedForSending: ((ri as unknown as { approvedForSending?: boolean }).approvedForSending ?? null),
    includePDF: ((ri as unknown as { includePDF?: boolean }).includePDF ?? null),
    lineItemCount: ri.lineItems?.length ?? 0,
    total: (ri.total ?? null) as number | null,
  };
}

/**
 * Flip a RepeatingInvoice template's status from DRAFT → AUTHORISED.
 * This is the action that makes Xero start generating children on the
 * schedule. ⚠ CUSTOMER-FACING: combined with approvedForSending=true on
 * the template (which our create flow sets by default) and the org-level
 * "auto-send when authorised" setting, the next child invoice goes out
 * by email automatically.
 *
 * Idempotent — calling on an already-AUTHORISED template just returns
 * the current state.
 */
export async function authoriseRepeatingInvoice(
  xero: XeroClient,
  tenantId: string,
  repeatingInvoiceId: string,
): Promise<RepeatingInvoiceState> {
  await xero.accountingApi.updateRepeatingInvoice(tenantId, repeatingInvoiceId, {
    repeatingInvoices: [{ status: "AUTHORISED" } as never],
  });
  return getRepeatingInvoice(xero, tenantId, repeatingInvoiceId);
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
