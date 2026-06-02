import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * Pre-fill the site asset register from a job's accepted-quote BOM (Michael,
 * 2026-06-02) — so the "picking list" and the asset list stop needing manual
 * cross-referencing.
 *
 * Creates ONE asset shell PER UNIT (Camera ×23 → 23 rows) at the job's site,
 * with device name + type + asset_type pre-filled and serial left blank for
 * the tech to scan in. Stamped with job_id so we can dedupe re-runs.
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

  // BOM lines + the catalogue device_type for each.
  const { data: lines } = await supabase
    .from("quote_line_items")
    .select("product_name, sku, quantity, quote_products ( name, device_type )")
    .eq("quote_id", quote.id)
    .order("sort_order", { ascending: true });
  if (!lines || lines.length === 0) {
    return NextResponse.json({ error: "Accepted quote has no line items" }, { status: 400 });
  }

  // Asset-type lookup by name (asset types are named like the catalogue
  // products, e.g. "PIR - Blue Line Gen2 Quad"). Pull the default make/model
  // so imported shells come pre-filled — the tech then only scans serials.
  const { data: assetTypes } = await supabase
    .from("asset_types")
    .select("id, name, default_manufacturer, default_model");
  const typeByName = new Map(
    (assetTypes ?? []).map((t) => [(t.name ?? "").trim().toLowerCase(), t.id as string]),
  );
  const defaultsById = new Map(
    (assetTypes ?? []).map((t) => [
      t.id as string,
      {
        manufacturer: (t.default_manufacturer ?? "").trim() || null,
        model: (t.default_model ?? "").trim() || null,
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
  for (const li of lines) {
    const prod = (Array.isArray(li.quote_products) ? li.quote_products[0] : li.quote_products) as
      | { name?: string | null; device_type?: string | null }
      | null;
    const name = (li.product_name ?? prod?.name ?? "").trim();
    if (!name) continue;
    const qty = Math.max(1, Math.round(Number(li.quantity) || 1));
    const assetTypeId =
      typeByName.get(name.toLowerCase()) ??
      typeByName.get((prod?.name ?? "").trim().toLowerCase()) ??
      null;
    const deviceType = prod?.device_type ?? null;
    // Pre-fill make + model from the matched asset type's defaults so Michael
    // doesn't re-type them per device. Model falls back to the BOM SKU when the
    // type has no default model set yet, so the part # is at least captured.
    const defaults = assetTypeId ? defaultsById.get(assetTypeId) : null;
    const manufacturer = defaults?.manufacturer ?? null;
    const model = defaults?.model ?? ((li.sku ?? "").trim() || null);
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
    return NextResponse.json({ error: "Nothing to import from this quote" }, { status: 400 });
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
  });
}
