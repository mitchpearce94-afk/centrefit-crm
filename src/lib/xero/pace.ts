/**
 * Pacing + 429 handling for bursts of Xero API calls.
 *
 * Xero allows 60 calls per rolling minute per tenant (and 5,000 per rolling
 * day, shared by everything using this app — see
 * memory reference_xero_daily_rate_limit_shared_with_prod). Anything that
 * fires more than a handful of calls in a loop (PO generation, the product
 * Item sync) must go through a pacer so the burst never outruns the window.
 *
 * 2026-10-16: "Generate POs" on Snap Austral (65 lines, 17 suppliers) pushed
 * ~100 calls in 60 s; Xero cut it off at exactly the minute mark and the last
 * five suppliers failed with a raw 429 blob in the toast. Same thing bit
 * Buderim on 14 Oct.
 *
 * No `server-only` import here on purpose — purchase-orders.ts re-exports
 * constants that non-route code may import.
 */

export type XeroPace = <T>(fn: () => Promise<T>) => Promise<T>;

export interface XeroRateLimitInfo {
  retryAfterSeconds: number;
  /** `minute` | `day` | `app` | unknown */
  problem: string;
}

/**
 * xero-node v15 rejects in three shapes: a plain JSON *string* of
 * `ApiError.generateError()` (the common one — NOT an Error instance), an
 * Error whose message is that JSON, or a bare `{ response, body }` object.
 * Pull a 429 out of any of them.
 */
export function parseXeroRateLimit(err: unknown): XeroRateLimitInfo | null {
  type Resp = { statusCode?: number; status?: number; headers?: Record<string, unknown> };
  let response: Resp | undefined;
  const tryParse = (s: string): Resp | undefined => {
    try {
      const o = JSON.parse(s) as { response?: Resp };
      return o?.response;
    } catch {
      return undefined;
    }
  };
  if (typeof err === "string") response = tryParse(err);
  else if (err && typeof err === "object") {
    const anyErr = err as { response?: Resp; message?: unknown; statusCode?: number };
    response = anyErr.response;
    if (!response && typeof anyErr.message === "string" && anyErr.message.startsWith("{")) {
      response = tryParse(anyErr.message);
    }
    if (!response && anyErr.statusCode) response = anyErr;
  }
  const status = Number(response?.statusCode ?? response?.status ?? 0);
  if (status !== 429) return null;
  const headers = (response?.headers ?? {}) as Record<string, unknown>;
  const header = (k: string) => {
    const hit = Object.keys(headers).find((h) => h.toLowerCase() === k);
    return hit ? String(headers[hit]) : undefined;
  };
  const retry = parseInt(header("retry-after") ?? "", 10);
  return {
    retryAfterSeconds: Number.isFinite(retry) && retry > 0 ? retry : 60,
    problem: header("x-rate-limit-problem") ?? "minute",
  };
}

export class XeroRateLimitError extends Error {
  constructor(public readonly info: XeroRateLimitInfo) {
    super(
      info.problem === "minute"
        ? `Xero rate limit reached — wait ${Math.max(info.retryAfterSeconds, 5)} s and try again`
        : `Xero ${info.problem} limit reached — try again in ${Math.ceil(info.retryAfterSeconds / 60)} min`,
    );
    this.name = "XeroRateLimitError";
  }
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Serialises Xero calls at most one per `minGapMs` (default 1.1 s → ~55/min,
 * under the 60/min window with room for whatever else is talking to Xero),
 * and on a *minute* 429 waits out `retry-after` once before retrying. A day
 * or app 429, or a second minute 429, surfaces as XeroRateLimitError so the
 * caller stops the run instead of hammering.
 */
export class XeroPacer {
  private lastStart = 0;
  private chain: Promise<unknown> = Promise.resolve();
  calls = 0;

  constructor(
    private readonly minGapMs = 1100,
    private readonly onRateLimited?: (info: XeroRateLimitInfo) => Promise<void> | void,
  ) {}

  /** Bindable `XeroPace` for passing into helpers. */
  readonly run: XeroPace = <T>(fn: () => Promise<T>): Promise<T> => {
    const next = this.chain.then(() => this.exec(fn));
    this.chain = next.catch(() => undefined);
    return next;
  };

  private async wait(): Promise<void> {
    const due = this.lastStart + this.minGapMs;
    const now = Date.now();
    if (due > now) await sleep(due - now);
    this.lastStart = Date.now();
    this.calls += 1;
  }

  private async exec<T>(fn: () => Promise<T>): Promise<T> {
    await this.wait();
    try {
      return await fn();
    } catch (err) {
      const info = parseXeroRateLimit(err);
      if (!info) throw err;
      if (info.problem !== "minute" || info.retryAfterSeconds > 90) {
        await this.onRateLimited?.(info);
        throw new XeroRateLimitError(info);
      }
      await sleep(info.retryAfterSeconds * 1000 + 1000);
      await this.wait();
      try {
        return await fn();
      } catch (err2) {
        const info2 = parseXeroRateLimit(err2);
        if (!info2) throw err2;
        await this.onRateLimited?.(info2);
        throw new XeroRateLimitError(info2);
      }
    }
  }
}

/** Identity pacer for callers that make one or two calls and don't need pacing. */
export const unpaced: XeroPace = (fn) => fn();
