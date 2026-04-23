// Server-side Kinetix Rev3 NBN API client.
// Base URL + auth headers. Credentials come from env vars — never expose.

const BASE_URL = "https://rev3.kinetix.net.au/api/v2/nbn";

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
