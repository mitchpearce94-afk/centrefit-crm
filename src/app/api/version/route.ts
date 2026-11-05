import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * GET /api/version — the build currently serving the app. Public (no session
 * needed, it only reveals a commit sha) so the DeployWatcher never gets a
 * login redirect instead of JSON. See next.config.ts for why this exists.
 */
export async function GET() {
  return NextResponse.json(
    { build: process.env.NEXT_PUBLIC_BUILD_ID ?? "unknown" },
    { headers: { "Cache-Control": "no-store, max-age=0" } },
  );
}
