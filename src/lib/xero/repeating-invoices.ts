import "server-only";
import { DEFAULT_SALES_ACCOUNT_CODE } from "@/lib/xero/account-codes";
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
   * Status the auto-generated children inherit. Default DRAFT, but the
   * recurring-plan flow (lib/recurring/activate-plan.ts) passes AUTHORISED
   * so new plans go live with auto-send enabled — Mitchell's 2026-05-27
   * call after the duplicate-invoice risk was contained by the idempotency
   * key + activation safety net. DRAFT remains available for callers that
   * want a manual approve step.
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

// default sales account shared with createXeroInvoice (203 · Sales - IT Install)
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
  // Xero rejects ApprovedForSending=true on DRAFT templates with
  // "Only AUTHORISED repeating invoices may have ApprovedForSending updated."
  // Set it ONLY on AUTHORISED. When Mitchell flips the template DRAFT →
  // AUTHORISED via authoriseRepeatingInvoice, we re-apply approvedForSending
  // there (see authoriseRepeatingInvoice below).
  if (childStatus === "AUTHORISED") {
    payload.approvedForSending = true;
  }

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

export interface RepeatingInvoiceSummary {
  repeatingInvoiceID: string;
  contactName: string;
  status: string;
  total: number | null;
  /** All line descriptions joined — used for service-keyword matching. */
  lineText: string;
}

/**
 * List ALL repeating invoice templates for the tenant (Xero returns the full
 * set in one response — no pagination on this endpoint). Used by the billing
 * watchdog to know who's invoiced outside the DD plans.
 */
export async function listRepeatingInvoices(
  xero: XeroClient,
  tenantId: string,
): Promise<RepeatingInvoiceSummary[]> {
  const res = await xero.accountingApi.getRepeatingInvoices(tenantId);
  return (res.body.repeatingInvoices ?? []).map((ri) => ({
    repeatingInvoiceID: ri.repeatingInvoiceID ?? "",
    contactName: ri.contact?.name ?? "",
    status: String(ri.status ?? "UNKNOWN"),
    total: (ri.total ?? null) as number | null,
    lineText: (ri.lineItems ?? []).map((l) => l.description ?? "").join(" || "),
  }));
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

export interface RepeatingInvoiceRawLine {
  description: string;
  quantity: number;
  unitAmount: number;
  accountCode: string | null;
  taxType: string | null;
}

/**
 * Fetch a template's current line items verbatim plus enough schedule state
 * to identify its cadence. Used by the add-service mirror to append a new
 * service line without clobbering what's already billing.
 */
export async function getRepeatingInvoiceLines(
  xero: XeroClient,
  tenantId: string,
  repeatingInvoiceId: string,
): Promise<{ status: string; schedulePeriod: number | null; lines: RepeatingInvoiceRawLine[] }> {
  const res = await xero.accountingApi.getRepeatingInvoice(tenantId, repeatingInvoiceId);
  const ri = res.body.repeatingInvoices?.[0];
  if (!ri) throw new Error(`Xero returned no RepeatingInvoice for ${repeatingInvoiceId}`);
  const sched = (ri.schedule ?? {}) as Record<string, unknown>;
  return {
    status: String(ri.status ?? "UNKNOWN"),
    schedulePeriod: (sched.period ?? null) as number | null,
    lines: (ri.lineItems ?? []).map((l) => ({
      description: l.description ?? "",
      quantity: Number(l.quantity ?? 1),
      unitAmount: Number(l.unitAmount ?? 0),
      accountCode: l.accountCode ?? null,
      taxType: (l as { taxType?: string }).taxType ?? null,
    })),
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
  // Flip to AUTHORISED first. ApprovedForSending can only be set on an
  // already-AUTHORISED template (Xero validation), so it goes in a second
  // call. Auto-send-when-authorised at the org level still drives whether
  // the next child actually emails — this just unblocks the flag.
  // The id must ride in the element as well as the URL — a status-only body
  // is validated as a NEW template (zero GUID, "Type must be specified").
  // Confirmed against Xero 2026-09-25 while deleting Benowa's old template.
  await xero.accountingApi.updateRepeatingInvoice(tenantId, repeatingInvoiceId, {
    repeatingInvoices: [{ repeatingInvoiceID: repeatingInvoiceId, status: "AUTHORISED", approvedForSending: true } as never],
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
  // id in the element too — see authoriseRepeatingInvoice.
  await xero.accountingApi.updateRepeatingInvoice(tenantId, repeatingInvoiceId, {
    repeatingInvoices: [{ repeatingInvoiceID: repeatingInvoiceId, status: "DELETED" } as never],
  });
}

/**
 * Reschedule an existing RepeatingInvoice template's first/next run date.
 * Used to reconcile a yearly RI whose StartDate was wrongly set to the
 * monthly date (the pre-2026-06-30 activate-plan bug, where the Xero loop
 * passed the monthly startDate for every cadence). Rescheduling a template
 * that hasn't generated its next child yet is NOT customer-facing — it only
 * moves WHEN Xero next generates (and auto-sends) a child; it does not email
 * or charge anyone now.
 *
 * Xero's RepeatingInvoice update is a whole-document upsert — sending only a
 * `schedule` makes Xero treat it as a NEW doc and fail validation (it then
 * demands Type/Contact/LineItems/Status, and the body carries a zero GUID).
 * So we fetch the full RI and resend it verbatim with just the schedule's
 * StartDate + NextScheduledDate moved. Returns the post-update state so the
 * caller can confirm Xero accepted the new date.
 */
export async function updateRepeatingInvoiceSchedule(
  xero: XeroClient,
  tenantId: string,
  repeatingInvoiceId: string,
  startDate: string,
): Promise<RepeatingInvoiceState> {
  const res = await xero.accountingApi.getRepeatingInvoice(tenantId, repeatingInvoiceId);
  const ri = res.body.repeatingInvoices?.[0];
  if (!ri) throw new Error(`Xero returned no RepeatingInvoice for ${repeatingInvoiceId}`);
  // SDK types schedule dates as string and accepts YYYY-MM-DD (as on create);
  // keep the rest of the schedule (period/unit/dueDate) as fetched.
  ri.schedule = {
    ...(ri.schedule ?? {}),
    startDate,
    nextScheduledDate: startDate,
  };
  await xero.accountingApi.updateRepeatingInvoice(tenantId, repeatingInvoiceId, {
    repeatingInvoices: [ri],
  });
  return getRepeatingInvoice(xero, tenantId, repeatingInvoiceId);
}

/**
 * The human-readable reason inside a xero-node error. The SDK's `message`
 * is the whole response body as JSON (1–2 KB); the part anyone needs is
 * `Elements[0].ValidationErrors[].Message`, which the recurring_plans.notes
 * column (1,000 chars) used to truncate away — Benowa 2026-09-25 hid
 * "Repeating invoice status must be set to DELETED" for half a day.
 */
export function xeroErrorMessage(err: unknown): string {
  const body = (err as { response?: { body?: unknown } })?.response?.body as
    | { Message?: string; Elements?: { ValidationErrors?: { Message?: string }[]; LineItems?: { ValidationErrors?: { Message?: string }[] }[] }[]; ValidationErrors?: { Message?: string }[] }
    | undefined;
  if (body && typeof body === "object") {
    const msgs = [
      ...(body.ValidationErrors ?? []),
      ...(body.Elements ?? []).flatMap((e) => [
        ...(e.ValidationErrors ?? []),
        ...(e.LineItems ?? []).flatMap((l) => l.ValidationErrors ?? []),
      ]),
    ].map((v) => v.Message).filter((m): m is string => !!m);
    if (msgs.length) return `Xero: ${Array.from(new Set(msgs)).join("; ")}`;
    if (body.Message) return `Xero: ${body.Message}`;
  }
  return err instanceof Error ? err.message : String(err);
}

/** Xero hands schedule dates back as "/Date(1792800000000+0000)/" (or ISO). */
function xeroDateToISO(value: unknown): string | null {
  if (!value) return null;
  const s = String(value);
  const m = /\/Date\((-?\d+)/.exec(s);
  const d = m ? new Date(Number(m[1])) : new Date(s);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

export interface UpdatedRepeatingInvoice {
  /** The template that now carries the lines — a NEW id when replaced. */
  repeatingInvoiceID: string;
  /** True when Xero made us create a replacement and delete the original. */
  replaced: boolean;
  /** True when the lines already matched and nothing was sent. */
  unchanged: boolean;
}

/**
 * Put a new set of line items on a plan's RepeatingInvoice template. Used by
 * the plan-edit flow (Edit services) and the add-service mirror when a
 * customer adds or removes services on an already-billing plan.
 *
 * What Xero actually allows (learned on Benowa, 2026-09-25):
 *  - Updates are whole-document upserts: a body with only `lineItems` is
 *    validated as a NEW template (zero GUID, "Type/Schedule/Contact must be
 *    specified"). Any in-place update resends the fetched object.
 *  - A DRAFT template can be edited in place.
 *  - An AUTHORISED template cannot be edited at all — every field change is
 *    refused with "Repeating invoice status must be set to DELETED". The
 *    only way to change what it bills is to create a replacement on the
 *    same schedule and delete the original. That is what this does: the
 *    replacement starts on the original's NextScheduledDate, so the customer
 *    sees the same cadence and the same next invoice date with the new
 *    lines; status, ApprovedForSending, branding, IncludePDF and reference
 *    are copied so auto-send behaviour is unchanged. If the delete of the
 *    original fails after the replacement exists, the replacement is deleted
 *    again so there is never a moment with two live templates.
 *  - Lines that already match are a no-op (the yearly template must not be
 *    churned every time the monthly one changes).
 *
 * Callers MUST persist the returned id — it changes when `replaced` is true.
 */
export async function updateRepeatingInvoiceLines(
  xero: XeroClient,
  tenantId: string,
  repeatingInvoiceId: string,
  lineItems: RepeatingInvoiceLineInput[],
): Promise<UpdatedRepeatingInvoice> {
  if (lineItems.length === 0) {
    throw new Error("Cannot update a RepeatingInvoice to zero line items — cancel it instead");
  }
  const res = await xero.accountingApi.getRepeatingInvoice(tenantId, repeatingInvoiceId);
  const ri = res.body.repeatingInvoices?.[0];
  if (!ri) throw new Error(`Xero returned no RepeatingInvoice for ${repeatingInvoiceId}`);
  const status = String(ri.status ?? "UNKNOWN");
  const wanted = lineItems.map((li) => ({
    description: li.description.slice(0, 4000),
    quantity: li.quantity ?? 1,
    unitAmount: li.unitAmount,
    accountCode: li.accountCode ?? DEFAULT_SALES_ACCOUNT_CODE,
    taxType: li.taxType ?? DEFAULT_TAX_TYPE_INCLUSIVE,
  }));
  const key = (l: { description?: string; quantity?: number; unitAmount?: number; accountCode?: string; taxType?: string }) =>
    `${(l.description ?? "").trim()}|${Number(l.quantity ?? 1)}|${Number(l.unitAmount ?? 0).toFixed(2)}|${l.accountCode ?? ""}|${l.taxType ?? ""}`;
  const current = (ri.lineItems ?? []).map((l) => key(l as never)).sort().join("\n");
  if (current === wanted.map(key).sort().join("\n")) {
    return { repeatingInvoiceID: repeatingInvoiceId, replaced: false, unchanged: true };
  }

  if (status === "DRAFT") {
    ri.lineItems = wanted;
    try {
      await xero.accountingApi.updateRepeatingInvoice(tenantId, repeatingInvoiceId, { repeatingInvoices: [ri] });
    } catch (err) {
      throw new Error(xeroErrorMessage(err));
    }
    return { repeatingInvoiceID: repeatingInvoiceId, replaced: false, unchanged: false };
  }
  if (status !== "AUTHORISED") {
    throw new Error(`RepeatingInvoice ${repeatingInvoiceId} is ${status} — nothing to update`);
  }

  // AUTHORISED: replace on the same schedule, then delete the original.
  const sched = (ri.schedule ?? {}) as Record<string, unknown>;
  const nextRun = xeroDateToISO(sched.nextScheduledDate) ?? xeroDateToISO(sched.startDate);
  if (!nextRun) throw new Error(`RepeatingInvoice ${repeatingInvoiceId} has no next scheduled date to carry over`);
  const extra = ri as unknown as { approvedForSending?: boolean; includePDF?: boolean; sendCopy?: boolean; markAsSent?: boolean; brandingThemeID?: string; reference?: string; lineAmountTypes?: string };
  const endDate = xeroDateToISO(sched.endDate);
  const payload: Record<string, unknown> = {
    type: ri.type ?? "ACCREC",
    status: "AUTHORISED",
    contact: { contactID: ri.contact?.contactID },
    schedule: {
      period: sched.period ?? 1,
      unit: sched.unit ?? "MONTHLY",
      dueDate: sched.dueDate ?? 7,
      dueDateType: sched.dueDateType ?? "DAYSAFTERBILLDATE",
      startDate: nextRun,
      nextScheduledDate: nextRun,
      ...(endDate ? { endDate } : {}),
    },
    lineAmountTypes: extra.lineAmountTypes ?? "Inclusive",
    lineItems: wanted,
    approvedForSending: extra.approvedForSending ?? true,
    includePDF: extra.includePDF ?? true,
    sendCopy: extra.sendCopy ?? false,
    markAsSent: extra.markAsSent ?? false,
  };
  if (extra.reference) payload.reference = String(extra.reference).slice(0, 255);
  if (extra.brandingThemeID) payload.brandingThemeID = extra.brandingThemeID;
  // Same lines against the same original → same key, so an SDK retry after a
  // 429 cannot mint a second replacement (the 2026-05-11 duplicate factory).
  const idempotencyKey = `replace-${repeatingInvoiceId}-${crypto
    .createHash("sha256")
    .update(wanted.map(key).sort().join("\n"))
    .digest("hex")
    .slice(0, 32)}`;
  let newId: string;
  try {
    const created = await xero.accountingApi.createRepeatingInvoices(
      tenantId,
      { repeatingInvoices: [payload as never] },
      undefined,
      idempotencyKey,
    );
    newId = created.body.repeatingInvoices?.[0]?.repeatingInvoiceID ?? "";
    if (!newId) throw new Error("Xero did not return a RepeatingInvoiceID for the replacement");
  } catch (err) {
    throw new Error(`replacement create failed: ${xeroErrorMessage(err)}`);
  }
  try {
    await xero.accountingApi.updateRepeatingInvoice(tenantId, repeatingInvoiceId, {
      repeatingInvoices: [{ repeatingInvoiceID: repeatingInvoiceId, status: "DELETED" } as never],
    });
  } catch (err) {
    // Never leave two live templates: roll the replacement back, then report.
    try {
      await xero.accountingApi.updateRepeatingInvoice(tenantId, newId, {
        repeatingInvoices: [{ repeatingInvoiceID: newId, status: "DELETED" } as never],
      });
    } catch {
      throw new Error(`original ${repeatingInvoiceId} could not be deleted (${xeroErrorMessage(err)}) AND the replacement ${newId} is still live — fix in Xero by hand`);
    }
    throw new Error(`original could not be deleted, replacement rolled back: ${xeroErrorMessage(err)}`);
  }
  return { repeatingInvoiceID: newId, replaced: true, unchanged: false };
}
