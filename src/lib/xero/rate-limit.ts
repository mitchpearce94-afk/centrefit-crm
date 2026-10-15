import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { parseXeroRateLimit } from "@/lib/xero/pace";

/**
 * Local cooldown for the Xero API quota.
 *
 * When we see a 429 from Xero (per-minute, per-day, or per-app), we write
 * `rate_limited_until` on the single row in `xero_connections`. Anything
 * about to call Xero checks this first and throws a fast-path error if
 * the cooldown is still in the future — saves the upstream 429 round-trip
 * and gives the caller a clean error to surface.
 *
 * The window decays naturally: once `rate_limited_until` is in the past,
 * `isXeroRateLimited` returns null and calls resume.
 */

export class XeroRateLimitedError extends Error {
  constructor(
    public readonly until: Date,
    public readonly reason: string,
  ) {
    super(`Xero rate-limited until ${until.toISOString()} (${reason})`);
    this.name = "XeroRateLimitedError";
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySupabaseClient = SupabaseClient | any;

/**
 * Return the rate-limit cooldown end-time if we're currently throttled,
 * otherwise null.
 */
export async function isXeroRateLimited(
  supabase: AnySupabaseClient,
): Promise<{ until: Date; reason: string } | null> {
  const { data } = await supabase
    .from("xero_connections")
    .select("rate_limited_until, rate_limited_reason")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!data?.rate_limited_until) return null;
  const until = new Date(data.rate_limited_until);
  if (until.getTime() <= Date.now()) return null;
  return { until, reason: data.rate_limited_reason ?? "rate_limited" };
}

/**
 * Throws XeroRateLimitedError if we're currently in cooldown. Call this
 * before attempting any Xero API operation.
 */
export async function assertXeroAvailable(supabase: AnySupabaseClient): Promise<void> {
  const limited = await isXeroRateLimited(supabase);
  if (limited) throw new XeroRateLimitedError(limited.until, limited.reason);
}

/**
 * Record a 429 from Xero. `retryAfterSeconds` comes from the response's
 * `retry-after` header. `problem` comes from `x-rate-limit-problem`
 * (`minute` | `day` | `app`).
 */
export async function recordXeroRateLimit(
  supabase: AnySupabaseClient,
  retryAfterSeconds: number,
  problem: string,
): Promise<void> {
  // Cap the cooldown at 24h so a malformed retry-after can't pin us
  // forever. The day-limit is the longest legitimate value (~8.5h max).
  const capped = Math.min(Math.max(retryAfterSeconds, 30), 86400);
  const until = new Date(Date.now() + capped * 1000).toISOString();
  await supabase
    .from("xero_connections")
    .update({
      rate_limited_until: until,
      rate_limited_reason: `${problem}-limit (${capped}s)`,
    })
    .order("created_at", { ascending: false })
    .limit(1);
}

/**
 * Inspect an unknown error and, if it looks like a Xero 429, record the
 * cooldown locally. Returns true when the error was a 429 (caller can
 * choose to swallow it), false otherwise (caller should rethrow).
 */
export async function captureXeroRateLimit(
  supabase: AnySupabaseClient,
  err: unknown,
): Promise<boolean> {
  // xero-node v15 rejects with a plain JSON *string* most of the time (not an
  // Error), so the old `err instanceof Error` check never saw a 429 — pace.ts
  // handles every shape it throws.
  const info = parseXeroRateLimit(err);
  if (!info) return false;
  await recordXeroRateLimit(supabase, info.retryAfterSeconds, info.problem);
  return true;
}
