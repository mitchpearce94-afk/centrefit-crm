// Server-side Kinetix Rev3 NBN API client.
// Base URL + auth headers. Credentials come from env vars — never expose.
//
// Quirks (hard-won): `.fullText` has a literal leading dot; qualification
// takes `loc_id`; ValidationException errors can arrive inside HTTP 200 as
// `[{code, reason, type: "ValidationException"}]`; other errors are either
// that array shape or `{message}` — normalise everything via kinetixGet/Send.

const BASE_URL = "https://rev3.kinetix.net.au/api/v2/nbn";

export class KinetixError extends Error {
  status: number;
  detail: unknown;
  constructor(message: string, status: number, detail?: unknown) {
    super(message);
    this.name = "KinetixError";
    this.status = status;
    this.detail = detail;
  }
}

function extractError(parsed: unknown): string | null {
  if (Array.isArray(parsed)) {
    const errs = (parsed as Array<{ code?: string; reason?: string; type?: string }>).filter(
      (e) => e && typeof e === "object" && e.type === "ValidationException",
    );
    if (errs.length > 0) return errs.map((e) => e.reason ?? e.code ?? "Validation error").join("; ");
    return null;
  }
  return null;
}

async function handle<T>(res: Response, label: string): Promise<T> {
  const text = await res.text();
  let parsed: unknown = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    throw new KinetixError(`Kinetix ${label}: non-JSON response: ${text.slice(0, 200)}`, res.status || 502);
  }
  if (!res.ok) {
    const arrMsg = Array.isArray(parsed)
      ? (parsed as Array<{ reason?: string; code?: string }>).map((e) => e?.reason ?? e?.code).filter(Boolean).join("; ")
      : null;
    const objMsg = parsed && typeof parsed === "object" && "message" in (parsed as object)
      ? String((parsed as { message: unknown }).message)
      : null;
    throw new KinetixError(arrMsg || objMsg || `Kinetix ${label} failed (HTTP ${res.status})`, res.status, parsed);
  }
  const validationMsg = extractError(parsed);
  if (validationMsg) throw new KinetixError(validationMsg, 400, parsed);
  return parsed as T;
}

/** Generic GET with query params. */
export async function kinetixGet<T = unknown>(
  path: string,
  params?: Record<string, string | number | boolean | undefined>,
): Promise<T> {
  const url = new URL(`${BASE_URL}${path}`);
  for (const [k, v] of Object.entries(params ?? {})) {
    if (v !== undefined) url.searchParams.set(k, String(v));
  }
  const res = await fetch(url.toString(), { headers: authHeaders(), cache: "no-store" });
  return handle<T>(res, `GET ${path}`);
}

/** Generic POST/PATCH/DELETE with JSON body. */
export async function kinetixSend<T = unknown>(
  method: "POST" | "PATCH" | "DELETE",
  path: string,
  body?: unknown,
): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: {
      ...authHeaders(),
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    cache: "no-store",
  });
  return handle<T>(res, `${method} ${path}`);
}

/**
 * Write helper for the Rev3 quirk that ALL mutations take QUERY PARAMETERS,
 * not JSON bodies (confirmed by the full swagger 2026-06-10). Booleans are
 * serialised lowercase. Pass `TESTING_MODE: true` to have Revolution simulate
 * without forwarding to NBN.
 */
export async function kinetixSendQ<T = unknown>(
  method: "POST" | "PATCH" | "DELETE",
  path: string,
  params?: Record<string, string | number | boolean | undefined>,
): Promise<T> {
  const url = new URL(`${BASE_URL}${path}`);
  for (const [k, v] of Object.entries(params ?? {})) {
    if (v !== undefined && v !== "") url.searchParams.set(k, String(v));
  }
  const res = await fetch(url.toString(), { method, headers: authHeaders(), cache: "no-store" });
  return handle<T>(res, `${method} ${path}`);
}

/** Paginated list helper — loops page/limit until a short batch. */
export async function kinetixGetAll<T = unknown>(
  path: string,
  params?: Record<string, string | number | boolean | undefined>,
  pageSize = 100,
  maxPages = 50,
): Promise<T[]> {
  const all: T[] = [];
  for (let page = 1; page <= maxPages; page++) {
    const data = await kinetixGet<unknown>(path, { ...params, page, limit: pageSize });
    const wrapper = data as { results?: T[]; items?: T[]; products?: T[]; count?: number };
    const items = Array.isArray(data)
      ? (data as T[])
      : (wrapper?.results ?? wrapper?.items ?? wrapper?.products ?? []);
    all.push(...items);
    if (items.length < pageSize) break;
    // Some Rev3 endpoints (/products/*) ignore page/limit and return the
    // full set every time — without this guard we'd loop duplicates.
    if (typeof wrapper?.count === "number" && all.length >= wrapper.count) break;
  }
  return all;
}

/**
 * Cached GET for slow-changing reference data (product details, addresses).
 * Uses the Next.js data cache so 100+ per-row lookups only hit Kinetix once
 * per revalidate window.
 */
export async function kinetixGetCached<T = unknown>(
  path: string,
  revalidateSecs = 1800,
): Promise<T> {
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: authHeaders(),
    next: { revalidate: revalidateSecs },
  });
  return handle<T>(res, `GET ${path}`);
}

/* ── Domain reads (Rev3 parity, read-only) ─────────────────────────── */

export type ProductStatusBucket = "active" | "in_progress" | "recently_disconnected";

export function fetchProductsByStatus(bucket: ProductStatusBucket) {
  return kinetixGetAll<ActiveProduct>(`/products/${bucket}`);
}

export function fetchProduct(productId: string) {
  return kinetixGet(`/products/${encodeURIComponent(productId)}`);
}

/** Cached product detail — used to enrich the bare-ID rows from /products/{bucket}. */
export function fetchProductDetailCached(productId: string) {
  return kinetixGetCached<Record<string, unknown>>(`/products/${encodeURIComponent(productId)}`);
}

/** Cached address record for a LOC id (formattedAddress lives here). */
export function fetchAddressCached(locId: string) {
  return kinetixGetCached<{ formattedAddress?: string; [k: string]: unknown }>(
    `/address/${encodeURIComponent(locId)}`,
    86400,
  );
}

/**
 * Cached end-user lookup by the NBN business ref found on a product's
 * relatedParty (BIZ…). Returns name/tradingName/contact — the only way the
 * Rev3 API exposes who a connection belongs to.
 */
export function fetchEndUserByBizRefCached(bizRef: string) {
  return kinetixGetCached<Array<{
    name?: string;
    tradingName?: string;
    contact?: { contactName?: string; emailAddress?: string };
    [k: string]: unknown;
  }>>(`/party/end_users?nbn_biz_ref=${encodeURIComponent(bizRef)}`, 86400);
}

export function fetchProductByServiceRef(serviceRef: string) {
  return kinetixGet(`/products/service/${encodeURIComponent(serviceRef)}`);
}

export function fetchRelatedOrders(reference: string) {
  return kinetixGet(`/products/related/${encodeURIComponent(reference)}/orders`);
}

export function fetchServiceOutages(serviceRef: string) {
  return kinetixGet(`/outage/service/${encodeURIComponent(serviceRef)}`);
}

export function fetchServiceAppointments(serviceRef: string) {
  return kinetixGet(`/appointments/service/${encodeURIComponent(serviceRef)}`);
}

export function fetchDiagnosticsRecent(serviceRef: string) {
  return kinetixGet(`/diagnostics/service/${encodeURIComponent(serviceRef)}`);
}

export function fetchDiagnosticsLatest(serviceRef: string) {
  return kinetixGet(`/diagnostics/service/${encodeURIComponent(serviceRef)}/latest`);
}

export function fetchDiagnosticsTestTypes(serviceRef: string) {
  return kinetixGet(`/diagnostics/service/${encodeURIComponent(serviceRef)}/test_types`);
}

export function fetchServiceHealthLatest(serviceRef: string) {
  return kinetixGet(`/service_health/service/${encodeURIComponent(serviceRef)}/latest`);
}

export function fetchFibreUpliftLocations() {
  return kinetixGetAll(`/fibre_uplift/locations`);
}

export function qualifyLocation(locId: string) {
  return kinetixGet(`/service_qualification/single_site`, { loc_id: locId });
}

/** Per-address fibre-uplift qualification (works on our key, unlike the account-wide /fibre_uplift/locations list). */
export function qualifyFibreUplift(locId: string) {
  return kinetixGet(`/service_qualification/fibre_uplift`, { loc_id: locId });
}

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

function authHeaders(): HeadersInit {
  return {
    "X-Apikey": requireEnv("KINETIX_API_KEY"),
    "X-APISecret": requireEnv("KINETIX_API_SECRET"),
    "X-UserRef": requireEnv("KINETIX_USER_REF"),
    Accept: "application/json",
  };
}

export interface ActiveProduct {
  id: string;
  serviceRef?: string;
  productType?: string;
  locationId?: string;
  formattedAddress?: string;
  technology?: string;
  status?: string;
  rspReferenceId?: string;
  activationDate?: string;
  [k: string]: unknown;
}

/**
 * List all active NBN products under Centrefit's Kinetix account.
 * Endpoint: GET /products/active
 * Paginated via `page` param; fetches all pages (capped at 20).
 */
export async function fetchActiveProducts(): Promise<{ products: ActiveProduct[]; raw: unknown[] }> {
  const products: ActiveProduct[] = [];
  const rawPages: unknown[] = [];

  for (let page = 1; page <= 20; page++) {
    const params = new URLSearchParams({ page: String(page), limit: "100" });
    const res = await fetch(`${BASE_URL}/products/active?${params.toString()}`, {
      headers: authHeaders(),
      cache: "no-store",
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Kinetix /products/active failed: ${res.status} ${text.slice(0, 200)}`);
    }
    const data = await res.json();
    rawPages.push(data);

    // The API likely returns either an array directly or a paginated wrapper.
    // Defensive parse: handle both.
    let batch: ActiveProduct[];
    if (Array.isArray(data)) {
      batch = data as ActiveProduct[];
    } else if (data && typeof data === "object" && Array.isArray((data as { results?: unknown }).results)) {
      batch = (data as { results: ActiveProduct[] }).results;
    } else {
      batch = [];
    }

    products.push(...batch);
    if (batch.length < 100) break;
  }

  return { products, raw: rawPages };
}

export interface AddressSearchMatch {
  id: string;
  formattedAddress: string;
  latitude?: string;
  longitude?: string;
  [k: string]: unknown;
}

/**
 * Free-text address search. Returns matching nbn™ LOC IDs.
 * Used when creating jobs/customers: staff types an address, picks a real
 * NBN location, CRM stores the LOC ID for future availability checks.
 */
export async function searchAddress(fullText: string, limit = 8): Promise<AddressSearchMatch[]> {
  const params = new URLSearchParams();
  params.set(".fullText", fullText);
  params.set("adjustFullText", "true");
  params.set("rankResults", "true");
  params.set("limit", String(Math.min(Math.max(limit, 1), 20)));

  const res = await fetch(`${BASE_URL}/address/search?${params.toString()}`, {
    headers: authHeaders(),
    cache: "no-store",
  });
  const data = await res.json();
  if (!Array.isArray(data)) return [];
  return data as AddressSearchMatch[];
}
