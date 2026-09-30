import "server-only";
import { createHash, timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";

/**
 * Bearer-token gate for Mark's Cortex CRM API (/api/cortex/*, docs/cortex-api.md).
 *
 * Mitchell, 30 Sep 2026: "just give Mark access to whatever" — his Cortex can
 * read jobs, quotes, customers and sites and create/schedule/update jobs.
 * Still out of bounds (standing rules): invoicing, pricing/cost, deletes and
 * the Finance section.
 *
 * Token: CORTEX_API_TOKEN, falling back to STATS_READONLY_TOKEN (the token
 * Mark's Cortex already holds as CRM_STATS_TOKEN) so nothing new has to be
 * handed over. Env unset → 503, bad token → 401. Light per-instance limiter.
 */

const NO_STORE = { "Cache-Control": "no-store" };
const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 120;
let windowStart = 0;
let windowCount = 0;

function tokenMatches(provided: string, expected: string): boolean {
  const a = createHash("sha256").update(provided).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

/** Returns an error response, or null when the caller is allowed through. */
export function cortexGate(req: NextRequest): NextResponse | null {
  const expected = process.env.CORTEX_API_TOKEN || process.env.STATS_READONLY_TOKEN;
  if (!expected) return NextResponse.json({ error: "Cortex API not configured" }, { status: 503, headers: NO_STORE });
  const auth = req.headers.get("authorization") ?? "";
  const provided = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (!provided || !tokenMatches(provided, expected)) {
    return NextResponse.json({ error: "Unauthorised" }, { status: 401, headers: NO_STORE });
  }
  const now = Date.now();
  if (now - windowStart > WINDOW_MS) { windowStart = now; windowCount = 0; }
  if (++windowCount > MAX_PER_WINDOW) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429, headers: NO_STORE });
  }
  return null;
}

export function ok(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: NO_STORE });
}

export function bad(message: string, status = 400, extra?: Record<string, unknown>) {
  return NextResponse.json({ error: message, ...(extra ?? {}) }, { status, headers: NO_STORE });
}

export async function readJsonBody(req: NextRequest): Promise<Record<string, unknown>> {
  try {
    const b = (await req.json()) as unknown;
    return b && typeof b === "object" && !Array.isArray(b) ? (b as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}
