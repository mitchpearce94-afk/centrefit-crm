import { NextRequest, NextResponse } from "next/server";
import { fetchProductDetailCached, fetchAddressCached, KinetixError } from "@/lib/kinetix/client";

/**
 * Row-enrichment lookup for the NBN services list (auth enforced by
 * middleware — dashboard API). The /products/{bucket} list only returns bare
 * PRI/AVC ids; the human-readable columns (customer ref, address, tech,
 * speed tier, state) come from the product detail + address records, both
 * cached server-side so 100+ rows don't hammer Kinetix on every page view.
 *   GET ?id=PRI000275636217 → { summary }
 */
export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id")?.trim();
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  try {
    const detail = await fetchProductDetailCached(id);

    const avc = (Array.isArray(detail.productRef) ? detail.productRef : []).find(
      (p: Record<string, unknown>) => typeof p?.id === "string" && (p.id as string).startsWith("AVC"),
    ) as Record<string, unknown> | undefined;

    const locId = (detail.relatedPlace as { id?: string } | undefined)?.id;
    let formattedAddress: string | null = null;
    if (locId) {
      try {
        formattedAddress = (await fetchAddressCached(locId)).formattedAddress ?? null;
      } catch {
        // address lookup is best-effort — row still renders without it
      }
    }

    return NextResponse.json({
      summary: {
        productId: id,
        serviceRef: avc?.id ?? null,
        customerRef: detail.customerRef ?? null,
        formattedAddress,
        locId: locId ?? null,
        technology: detail.accessServiceTechnologyType ?? null,
        speedTier: avc?.bandwidthProfile ?? null,
        state: detail.state ?? null,
        endUserType: detail.endUserType ?? null,
        activated: detail.firstActivationDate ?? null,
      },
    });
  } catch (err) {
    if (err instanceof KinetixError) {
      return NextResponse.json({ error: err.message }, { status: err.status >= 400 && err.status < 600 ? err.status : 502 });
    }
    return NextResponse.json({ error: err instanceof Error ? err.message : "Kinetix request failed" }, { status: 502 });
  }
}
