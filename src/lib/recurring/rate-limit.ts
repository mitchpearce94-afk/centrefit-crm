import "server-only";

/**
 * Per-IP rate limiter for the public recurring-signup endpoint. In-memory
 * sliding window — a deliberate v1 choice. Vercel serverless cold-starts
 * mean state can reset and bursts can sneak through across instances; for
 * a public endpoint that creates DB rows + GC API calls, that's a real
 * abuse vector. Upgrade path: swap the body for Vercel KV (or Upstash) the
 * day someone hits the endpoint with abusive volume.
 *
 * Threshold: 3 attempts / 10 minutes / IP. Generous enough that a real
 * customer typo-and-retrying never hits it, tight enough that a bot
 * iterating combos gets blocked fast.
 */

const WINDOW_MS = 10 * 60 * 1000;
const MAX_ATTEMPTS = 3;

interface Bucket {
  hits: number[];
}

const buckets = new Map<string, Bucket>();

export function checkRateLimit(ip: string): { ok: boolean; retryAfterSec?: number } {
  const now = Date.now();
  const bucket = buckets.get(ip) ?? { hits: [] };
  bucket.hits = bucket.hits.filter((t) => now - t < WINDOW_MS);

  if (bucket.hits.length >= MAX_ATTEMPTS) {
    const oldest = bucket.hits[0];
    return { ok: false, retryAfterSec: Math.ceil((WINDOW_MS - (now - oldest)) / 1000) };
  }

  bucket.hits.push(now);
  buckets.set(ip, bucket);
  return { ok: true };
}

export function clientIp(req: Request): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim();
  return req.headers.get("x-real-ip") ?? "unknown";
}
