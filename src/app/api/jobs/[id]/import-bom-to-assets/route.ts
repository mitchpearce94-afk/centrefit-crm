import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * Pre-fill the site asset register from a job's accepted-quote BOM (Michael,
 * 2026-06-02) — so the "picking list" and the asset list stop needing manual
 * cross-referencing.
 *
 * Only creates shells for BOM products mapped to a TRACKABLE asset type
 * (something with a serial / MAC / IP / Wi-Fi / RFID worth recording). Cable,
 * mounts, brackets and consumables are skipped — they don't belong in the
 * register. Mapping is via quote_products.asset_type_id (tag a product once on
 * the Products page), with a legacy fallback to name-matching the asset type.
 *
 * Creates ONE shell PER UNIT (Camera ×23 → 23 rows), prefilled with device
 * name + type + make + model, serial/MAC/IP/Wi-Fi left blank for the tech to
 * fill on site. Stamped with job_id so re-runs dedupe.
 */
const MAX_UNITS = 500; // safety cap

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id: jobId } = await ctx.params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as { force?: boolean };

  // Job → site.
  const { data: job } = await supabase
    .from("jobs")
    .select("id, site_id")
    .eq("id", jobId)
    .maybeSingle();
  if (!job) return NextResponse.json({ error: "Job not found" }, { status: 404 });
  if (!job.site_id) {
    return NextResponse.json({ error: "This job has no site — assets need a site to live on." }, { status: 400 });
  }

  // Don't silently duplicate: if this job already has imported assets, stop
  // unless the caller explicitly forces it.
  const { count: existingCount } = await supabase
    .from("site_assets")
    .select("id", { count: "exact", head: true })
    .eq("job_id", jobId);
  if ((existingCount ?? 0) > 0 && !body.force) {
    return NextResponse.json({ alreadyImported: true, existing: existingCount });
  }

  // Most recent accepted quote for the job.
  const { data: quote } = await supabase
    .from("quotes")
    .select("id, ref")
    .eq("job_id", jobId)
    .eq("status", "accepted")
    .order("accepted_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!quote) {
    return NextResponse.json({ error: "No accepted quote found for this job" }, { status: 400 });
  }

  // BOM lines + the catalogue product's asset-type mapping + device_type.
  const { data: lines } = await supabase
    .from("quote_line_items")
    .select("product_name, sku, quantity, quote_products ( name, device_type, asset_type_id )")
    .eq("quote_id", quote.id)
    .order("sort_order", { ascending: true });
  if (!lines || lines.length === 0) {
    return NextResponse.json({ error: "Accepted quote has no line items" }, { status: 400 });
  }

  // Asset types: name lookup (legacy fallback), plus per-type metadata — the
  // default make/model to pre-fill, and whether the type is "trackable" (has a
  // serial / MAC / IP / Wi-Fi / RFID worth recording per unit). Only trackable
  // types become asset shells; everything else (cable, mounts) is skipped.
  const { data: assetTypes } = await supabase
    .from("asset_types")
    .select(
      "id, name, default_manufacturer, default_model, has_serial, has_mac, has_ip, has_wifi, has_rfid",
    );
  const typeByName = new Map(
    (assetTypes ?? []).map((t) => [(t.name ?? "").trim().toLowerCase(), t.id as string]),
  );
  const metaById = new Map(
    (assetTypes ?? []).map((t) => [
      t.id as string,
      {
        name: (t.name ?? "").trim() || null,
        manufacturer: (t.default_manufacturer ?? "").trim() || null,
        model: (t.default_model ?? "").trim() || null,
        trackable: !!(t.has_serial || t.has_mac || t.has_ip || t.has_wifi || t.has_rfid),
      },
    ]),
  );

  type Row = {
    site_id: string;
    job_id: string;
    device_name: string;
    device_type: string | null;
    manufacturer: string | null;
    model: string | null;
    asset_type_id: string | null;
    is_active: boolean;
  };
  const rows: Row[] = [];
  const skipped: string[] = []; // distinct product names skipped (not trackable)
  for (const li of lines) {
    const prod = (Array.isArray(li.quote_products) ? li.quote_products[0] : li.quote_products) as
      | { name?: string | null; device_type?: string | null; asset_type_id?: string | null }
      | null;
    const name = (li.product_name ?? prod?.name ?? "").trim();
    if (!name) continue;

    // Resolve the asset type: product tag wins, else legacy name match.
    const assetTypeId =
      prod?.asset_type_id ??
      typeByName.get(name.toLowerCase()) ??
      typeByName.get((prod?.name ?? "").trim().toLowerCase()) ??
      null;
    const meta = assetTypeId ? metaById.get(assetTypeId) : null;

    // Skip anything that isn't a trackable device — keeps cable / mounts /
    // consumables out of the asset register.
    if (!meta || !meta.trackable) {
      if (!skipped.includes(name)) skipped.push(name);
      continue;
    }

    const qty = Math.max(1, Math.round(Number(li.quantity) || 1));
    // Prefer the asset type's name for the device label so the register reads
    // consistently ("Camera" not "Dahua HDW3667 Black"); fall back to the BOM
    // product name if the type somehow has none.
    const deviceType = meta.name ?? prod?.device_type ?? null;
    // Make/model from the type defaults; model falls back to the BOM SKU when
    // the type has no default model set yet, so the part # is at least captured.
    const manufacturer = meta.manufacturer ?? null;
    const model = meta.model ?? ((li.sku ?? "").trim() || null);
    for (let i = 0; i < qty; i++) {
      rows.push({
        site_id: job.site_id,
        job_id: jobId,
        device_name: name,
        device_type: deviceType,
        manufacturer,
        model,
        asset_type_id: assetTypeId,
        is_active: true,
      });
      if (rows.length >= MAX_UNITS) break;
    }
    if (rows.length >= MAX_UNITS) break;
  }

  if (rows.length === 0) {
    return NextResponse.json(
      {
        error:
          skipped.length > 0
            ? "No trackable devices on this quote — every line is cable/mounts/consumables or its product isn't mapped to an asset type yet (tag them on the Products page)."
            : "Nothing to import from this quote",
        skipped,
      },
      { status: 400 },
    );
  }

  const { data: inserted, error: insErr } = await supabase
    .from("site_assets")
    .insert(rows)
    .select("id");
  if (insErr) return NextResponse.json({ error: insErr.message }, { status: 500 });

  return NextResponse.json({
    ok: true,
    created: inserted?.length ?? 0,
    siteId: job.site_id,
    quoteRef: quote.ref,
    capped: rows.length >= MAX_UNITS,
    skipped,
    skippedCount: skipped.length,
  });
}
