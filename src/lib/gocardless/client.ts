import "server-only";

/**
 * Minimal GoCardless API client. We only need a handful of endpoints
 * (customers, redirect_flows, billing requests for mandates) so a
 * focused fetch wrapper is lighter than pulling the full SDK.
 *
 * Auth: bearer token via GOCARDLESS_API_TOKEN env var.
 * Environment: GOCARDLESS_ENVIRONMENT=live | sandbox.
 *
 * Webhook signature verification lives in `webhook-verify.ts` so it can be
 * imported without dragging the whole client into webhook routes.
 */

const LIVE_BASE = "https://api.gocardless.com";
const SANDBOX_BASE = "https://api-sandbox.gocardless.com";

// GoCardless requires this version header. Pinning to a stable release
// — bump deliberately when GC publishes breaking changes.
const GC_VERSION = "2015-07-06";

function baseUrl(): string {
  return process.env.GOCARDLESS_ENVIRONMENT === "sandbox" ? SANDBOX_BASE : LIVE_BASE;
}

function token(): string {
  const t = process.env.GOCARDLESS_API_TOKEN;
  if (!t) throw new Error("GOCARDLESS_API_TOKEN is not set");
  return t;
}

interface GcRequestInit {
  method?: "GET" | "POST" | "PUT" | "DELETE";
  body?: unknown;
  /** Idempotency key — required by GC for POSTs that mutate state. */
  idempotencyKey?: string;
}

class GoCardlessApiError extends Error {
  constructor(
    public status: number,
    public body: unknown,
    message: string,
  ) {
    super(message);
    this.name = "GoCardlessApiError";
  }
}

async function gcFetch<T>(path: string, init: GcRequestInit = {}): Promise<T> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token()}`,
    "GoCardless-Version": GC_VERSION,
    Accept: "application/json",
  };
  if (init.body !== undefined) headers["Content-Type"] = "application/json";
  if (init.idempotencyKey) headers["Idempotency-Key"] = init.idempotencyKey;

  const res = await fetch(`${baseUrl()}${path}`, {
    method: init.method ?? "GET",
    headers,
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    cache: "no-store",
  });

  const text = await res.text();
  let parsed: unknown = null;
  try { parsed = text ? JSON.parse(text) : null; } catch { parsed = text; }

  if (!res.ok) {
    const msg =
      typeof parsed === "object" && parsed && "error" in parsed
        ? JSON.stringify((parsed as { error: unknown }).error)
        : text || res.statusText;
    throw new GoCardlessApiError(res.status, parsed, `GoCardless ${res.status}: ${msg}`);
  }

  return parsed as T;
}

// ─── Types (just the shapes we use) ─────────────────────────────────────────

export interface GcAddress {
  address_line1?: string;
  address_line2?: string;
  city?: string;
  region?: string;
  postal_code?: string;
  country_code?: string; // ISO 3166-1 alpha-2; "AU" for Centrefit
}

export interface GcCustomerInput extends GcAddress {
  email: string;
  given_name?: string;
  family_name?: string;
  company_name?: string;
  language?: string;
}

export interface GcCustomer extends GcCustomerInput {
  id: string;
  created_at: string;
}

export interface GcRedirectFlowInput {
  description: string;
  session_token: string;
  success_redirect_url: string;
  /**
   * Pre-fill the customer fields in the hosted form so they can't be edited
   * (well, can't be changed in a way that breaks our linking). Email is the
   * critical one — we lock it to the alias so the resulting mandate matches
   * the right Xero contact.
   */
  prefilled_customer?: GcCustomerInput;
  /** Existing GC customer ID — when set, GC ties the new mandate to it. */
  links?: { customer?: string };
}

export interface GcRedirectFlow {
  id: string;
  description: string;
  redirect_url: string;
  scheme: string;
  session_token: string;
  created_at: string;
  links: { customer?: string; mandate?: string; creditor?: string };
}

export interface GcMandate {
  id: string;
  status:
    | "pending_customer_approval"
    | "pending_submission"
    | "submitted"
    | "active"
    | "failed"
    | "cancelled"
    | "expired"
    | "consumed"
    | "blocked";
  scheme: string;
  reference: string | null;
  created_at: string;
  links: { customer: string; creditor: string; customer_bank_account: string };
}

// ─── API surface ─────────────────────────────────────────────────────────────

/**
 * Create a GoCardless customer record. Pre-creating the customer means the
 * mandate signup form only asks for bank details — name/email/address are
 * locked in by us, which is what makes the email-alias-per-site pattern work.
 */
export async function createCustomer(
  input: GcCustomerInput,
  idempotencyKey?: string,
): Promise<GcCustomer> {
  const res = await gcFetch<{ customers: GcCustomer }>("/customers", {
    method: "POST",
    body: { customers: input },
    idempotencyKey,
  });
  return res.customers;
}

/**
 * Create a redirect flow for the customer to authorise a mandate. The
 * returned `redirect_url` is the GC-hosted form URL we email to the
 * customer — they fill in bank details, sign, GC sends them back to
 * `success_redirect_url`.
 */
export async function createRedirectFlow(
  input: GcRedirectFlowInput,
  idempotencyKey?: string,
): Promise<GcRedirectFlow> {
  const res = await gcFetch<{ redirect_flows: GcRedirectFlow }>("/redirect_flows", {
    method: "POST",
    body: { redirect_flows: input },
    idempotencyKey,
  });
  return res.redirect_flows;
}

/**
 * Complete a redirect flow once the customer returns to our success URL.
 * Returns the final mandate + customer linkage. Idempotent — calling it
 * multiple times with the same session_token returns the same mandate.
 */
export async function completeRedirectFlow(
  redirectFlowId: string,
  sessionToken: string,
): Promise<GcRedirectFlow> {
  const res = await gcFetch<{ redirect_flows: GcRedirectFlow }>(
    `/redirect_flows/${redirectFlowId}/actions/complete`,
    {
      method: "POST",
      body: { data: { session_token: sessionToken } },
    },
  );
  return res.redirect_flows;
}

export async function getMandate(mandateId: string): Promise<GcMandate> {
  const res = await gcFetch<{ mandates: GcMandate }>(`/mandates/${mandateId}`);
  return res.mandates;
}

/**
 * Cancel a GoCardless mandate. After cancellation the mandate can no longer
 * be used to take payments. Idempotent — calling on an already-cancelled
 * mandate returns success without changing state.
 */
export async function cancelMandate(mandateId: string): Promise<GcMandate> {
  const res = await gcFetch<{ mandates: GcMandate }>(
    `/mandates/${mandateId}/actions/cancel`,
    { method: "POST" },
  );
  return res.mandates;
}

// ─── Billing Requests (newer API, supports field locking) ────────────────────
//
// AU BECS accounts block direct POST /customers but support the Billing
// Request flow. BRs let us lock prefilled customer fields so the customer
// can't accidentally edit the email — critical when we're using `+sitename`
// aliases for multi-site mandate→Xero contact mapping.

export interface GcBillingRequestInput {
  mandate_request: {
    scheme: string; // "becs" for AU
    currency?: string;
    metadata?: Record<string, string>;
    description?: string;
  };
  metadata?: Record<string, string>;
}

export interface GcBillingRequest {
  id: string;
  status:
    | "pending"
    | "ready_to_fulfil"
    | "fulfilling"
    | "fulfilled"
    | "cancelled"
    | "failed";
  created_at: string;
  links: {
    customer?: string;
    customer_billing_detail?: string;
    mandate_request?: string;
    mandate_request_mandate?: string;
    payment_request?: string;
    payment_request_payment?: string;
  };
  metadata: Record<string, string>;
}

export interface GcBillingRequestFlowInput {
  redirect_uri: string;
  exit_uri?: string;
  links: { billing_request: string };
  prefilled_customer?: GcCustomerInput;
  /** Locks all prefilled customer detail fields. Customer cannot edit them. */
  lock_customer_details?: boolean;
  /** Lock individual fields. Use this OR lock_customer_details, not both. */
  lock_bank_account_details?: boolean;
  /** Auto-fulfil the billing request once the customer completes. */
  auto_fulfil?: boolean;
  /** Show the success / cancel redirect buttons on the GC-hosted form. */
  show_redirect_buttons?: boolean;
}

export interface GcBillingRequestFlow {
  id: string;
  authorisation_url: string;
  expires_at: string;
  redirect_uri: string;
  links: { billing_request: string };
}

export async function createBillingRequest(
  input: GcBillingRequestInput,
  idempotencyKey?: string,
): Promise<GcBillingRequest> {
  const res = await gcFetch<{ billing_requests: GcBillingRequest }>("/billing_requests", {
    method: "POST",
    body: { billing_requests: input },
    idempotencyKey,
  });
  return res.billing_requests;
}

export async function createBillingRequestFlow(
  input: GcBillingRequestFlowInput,
  idempotencyKey?: string,
): Promise<GcBillingRequestFlow> {
  const res = await gcFetch<{ billing_request_flows: GcBillingRequestFlow }>(
    "/billing_request_flows",
    { method: "POST", body: { billing_request_flows: input }, idempotencyKey },
  );
  return res.billing_request_flows;
}

export async function getBillingRequest(billingRequestId: string): Promise<GcBillingRequest> {
  const res = await gcFetch<{ billing_requests: GcBillingRequest }>(
    `/billing_requests/${billingRequestId}`,
  );
  return res.billing_requests;
}

export { GoCardlessApiError };
