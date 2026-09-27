import { createHash, timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { buildDailyStats } from "@/lib/stats/daily";

/**
 * GET /api/stats/daily — read-only daily snapshot for Mark's Cortex
 * morning briefing. Shape documented in docs/stats-endpoint.md.
 *
 * Auth: `Authorization: Bearer <STATS_READONLY_TOKEN>` only (timing-safe
 * compare). No session path. Env unset → 503, bad/missing token → 401.
 * Public in middleware (PUBLIC_PATH_PREFIXES) so the token check here is
 * the only gate.
 *
 * Rails: SELECT-only, sell values only — no cost, margin, supplier, vault,
 * finance-agent or Xero data. See lib/stats/daily.ts.
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const NO_STORE = { "Cache-Control": "no-store" };

// Light per-instance limiter: it's meant to be pulled once a day.
const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 10;
let windowStart = 0;
let windowCount = 0;

function tokenMatches(provided: string, expected: string): boolean {
  // Hash both sides so lengths match and timingSafeEqual never throws.
  const a = createHash("sha256").update(provided).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

export async function GET(req: NextRequest) {
  const expected = process.env.STATS_READONLY_TOKEN;
  if (!expected) {
    return NextResponse.json({ error: "Stats endpoint not configured" }, { status: 503, headers: NO_STORE });
  }
  const header = req.headers.get("authorization") ?? "";
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  if (!match || !tokenMatches(match[1].trim(), expected)) {
    return NextResponse.json({ error: "Unauthorised" }, { status: 401, headers: NO_STORE });
  }

  const nowMs = Date.now();
  if (nowMs - windowStart > WINDOW_MS) {
    windowStart = nowMs;
    windowCount = 0;
  }
  if (++windowCount > MAX_PER_WINDOW) {
    return NextResponse.json(
      { error: "Too many requests" },
      { status: 429, headers: { ...NO_STORE, "Retry-After": "60" } },
    );
  }

  try {
    const stats = await buildDailyStats(createServiceRoleClient());
    return NextResponse.json(stats, { headers: NO_STORE });
  } catch (e) {
    console.error("[stats/daily]", e);
    return NextResponse.json({ error: "Failed to build stats" }, { status: 500, headers: NO_STORE });
  }
}
