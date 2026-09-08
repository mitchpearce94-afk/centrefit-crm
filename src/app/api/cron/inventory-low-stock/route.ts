import { NextRequest, NextResponse } from "next/server";
import { checkLowStock } from "@/lib/inventory/low-stock";

/**
 * Weekday 7am Brisbane — low-stock sweep (docs/inventory-CONTEXT.md D6).
 *
 * The routes that move stock already fire the alert immediately; this is the
 * safety net for anything that slipped through (a trigger-driven movement
 * with no route follow-up, a failed email) and it re-arms items whose stock
 * has climbed back above the reorder point.
 *
 * Auth: X-Cf-Cron-Secret (or Bearer) matches CRON_SECRET.
 */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const provided =
    req.headers.get("x-cf-cron-secret") ??
    req.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!secret) {
    return NextResponse.json({ error: "CRON_SECRET not configured" }, { status: 500 });
  }
  if (provided !== secret) {
    return NextResponse.json({ error: "Unauthorised" }, { status: 401 });
  }

  const result = await checkLowStock();
  return NextResponse.json({ ok: true, ...result });
}
