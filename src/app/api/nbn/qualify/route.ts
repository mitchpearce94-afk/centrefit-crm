import { NextRequest, NextResponse } from "next/server";
import { searchAddress, qualifyLocation, KinetixError } from "@/lib/kinetix/client";

/**
 * Staff-side NBN qualification tool (auth enforced by middleware — this is a
 * dashboard API, not a public one).
 *   { mode: "search", fullText }  → address matches
 *   { mode: "qualify", locId }    → full single-site qualification payload
 */
export async function POST(req: NextRequest) {
  let body: { mode?: string; fullText?: string; locId?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  try {
    if (body.mode === "search") {
      const fullText = body.fullText?.trim();
      if (!fullText || fullText.length < 4) {
        return NextResponse.json({ error: "Address too short" }, { status: 400 });
      }
      const matches = await searchAddress(fullText, 8);
      return NextResponse.json({ matches });
    }
    if (body.mode === "qualify") {
      const locId = body.locId?.trim();
      if (!locId) return NextResponse.json({ error: "locId required" }, { status: 400 });
      const result = await qualifyLocation(locId);
      return NextResponse.json({ result });
    }
    return NextResponse.json({ error: "Unknown mode" }, { status: 400 });
  } catch (err) {
    if (err instanceof KinetixError) {
      return NextResponse.json({ error: err.message }, { status: err.status >= 400 && err.status < 600 ? err.status : 502 });
    }
    return NextResponse.json({ error: err instanceof Error ? err.message : "Kinetix request failed" }, { status: 502 });
  }
}
