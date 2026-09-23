import "server-only";

// GoCardless reads for the finance agent: payouts, payout items, payments,
// mandates, customers. Read-only. The write side of GC (mandates, subs) lives
// in lib/gocardless/client.ts and is untouched.

const GC_VERSION = "2015-07-06";
const base = () => (process.env.GOCARDLESS_ENVIRONMENT === "sandbox" ? "https://api-sandbox.gocardless.com" : "https://api.gocardless.com");
const token = () => {
  const t = process.env.GOCARDLESS_API_TOKEN;
  if (!t) throw new Error("GOCARDLESS_API_TOKEN is not set");
  return t;
};

export class GcRestError extends Error {
  constructor(public status: number, public body: string, path: string) {
    super(`GoCardless ${status} on ${path.split("?")[0]}: ${body.slice(0, 200)}`);
    this.name = "GcRestError";
  }
}

async function gcGet<T>(path: string): Promise<T> {
  const res = await fetch(`${base()}/${path}`, {
    headers: { Authorization: `Bearer ${token()}`, "GoCardless-Version": GC_VERSION, Accept: "application/json" },
    cache: "no-store",
  });
  const text = await res.text();
  if (!res.ok) throw new GcRestError(res.status, text, path);
  return JSON.parse(text) as T;
}

async function gcList<T>(resource: string, params: Record<string, string>): Promise<T[]> {
  const all: T[] = [];
  let after: string | undefined;
  for (let page = 0; page < 40; page++) {
    const qs = new URLSearchParams({ limit: "500", ...params, ...(after ? { after } : {}) });
    const body = await gcGet<{ [k: string]: unknown; meta?: { cursors?: { after?: string } } }>(`${resource}?${qs}`);
    all.push(...((body[resource] as T[]) ?? []));
    after = body.meta?.cursors?.after;
    if (!after) break;
  }
  return all;
}

export interface GcPayout { id: string; amount: number; deducted_fees: number; currency: string; arrival_date: string; created_at: string; status: string; reference?: string | null; payout_type?: string }
export interface GcPayoutItem { type: string; amount: string; links?: { payment?: string; refund?: string } }
export interface GcPayment { id: string; amount: number; currency: string; charge_date: string; status: string; description?: string | null; reference?: string | null; links?: { subscription?: string; mandate?: string; payout?: string } }
export interface GcMandate { id: string; status: string; links?: { customer?: string; customer_bank_account?: string } }
export interface GcCustomer { id: string; email?: string | null; company_name?: string | null; given_name?: string | null; family_name?: string | null; metadata?: Record<string, string> }

export const listPayoutsSince = (sinceISODate: string) => gcList<GcPayout>("payouts", { "created_at[gte]": `${sinceISODate}T00:00:00Z` });
export const listPayoutItems = (payoutId: string) => gcList<GcPayoutItem>("payout_items", { payout: payoutId });
export const getPayment = async (id: string) => (await gcGet<{ payments: GcPayment }>(`payments/${id}`)).payments;
export const getMandate = async (id: string) => (await gcGet<{ mandates: GcMandate }>(`mandates/${id}`)).mandates;
export const getCustomer = async (id: string) => (await gcGet<{ customers: GcCustomer }>(`customers/${id}`)).customers;
export const listActiveMandates = () => gcList<GcMandate>("mandates", { status: "active" });
export const listCustomers = () => gcList<GcCustomer>("customers", {});
export const gcCustomerName = (c: GcCustomer) => (c.company_name ?? `${c.given_name ?? ""} ${c.family_name ?? ""}`).trim();

/** payout_items amounts are strings in cents ("-316", "16374"). */
export const payoutItemCents = (it: GcPayoutItem) => Math.round(Number(it.amount));
