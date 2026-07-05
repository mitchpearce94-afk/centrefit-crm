import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service";
import { renderWifiPosterPdf } from "@/lib/handover/wifi-poster";

/**
 * Guest Wi-Fi QR poster (Phase D — Mitchell 2026-07-05): a SEPARATE
 * print-ready branded page, never embedded in the handover pack. The QR
 * encodes WIFI:T:WPA;S:<ssid>;P:<password>;; so members scan to join
 * without the password ever being shown or given out. Staff-only route;
 * per-network via ?ssid=.
 */

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id: siteId } = await ctx.params;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const ssid = req.nextUrl.searchParams.get("ssid")?.trim();
  if (!ssid) return NextResponse.json({ error: "ssid query parameter is required" }, { status: 400 });

  const sb = createServiceRoleClient();
  const [{ data: site }, { data: assets }] = await Promise.all([
    sb.from("customer_sites").select("name").eq("id", siteId).single(),
    sb.from("site_assets").select("wifi_ssids").eq("site_id", siteId).eq("is_active", true),
  ]);
  if (!site) return NextResponse.json({ error: "Site not found" }, { status: 404 });

  let network: { ssid: string; password: string } | null = null;
  for (const a of assets ?? []) {
    for (const w of (a.wifi_ssids as { ssid?: string; password?: string }[] | null) ?? []) {
      if (w?.ssid === ssid) {
        network = { ssid: w.ssid, password: w.password ?? "" };
        break;
      }
    }
    if (network) break;
  }
  if (!network) return NextResponse.json({ error: `No Wi-Fi network "${ssid}" on this site's key info` }, { status: 404 });

  let pdf: Buffer;
  try {
    pdf = await renderWifiPosterPdf({ siteName: site.name as string, ssid: network.ssid, password: network.password });
  } catch (err) {
    return NextResponse.json(
      { error: `Poster render failed: ${err instanceof Error ? err.message : String(err)}` },
      { status: 500 },
    );
  }

  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="WiFi Poster - ${ssid.replace(/[^\w.\- ()]/g, "_")}.pdf"`,
    },
  });
}
