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
 * fill on site.
 *
 * Re-runs TOP UP instead of duplicating (Tuggeranong lesson, 2026-07-13):
 * existing shells from this job are counted per (device name + asset type)
 * and only the missing units are created — so tagging a product that was
 * missed the first time and re-running imports just that product. Skipped
 * lines are reported with a reason so an unmapped product is loud, not
 * silently dropped:
 *   - unmapped    → product has no asset-type tag (fix on Settings → Products)
 *   - consumable  → mapped to a non-trackable type (correctly left out)
 */
const MAX_UNITS = 500; // safety cap

type SkippedLine = { name: string; qty: number };

export async function POST(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id: jobId } = await ctx.params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorised" }, { status: 401 });

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

  // Prefer the most recent accepted quote; if there isn't one yet (e.g. the
  // quote is still draft on a test/early job), fall back to the most recent
  // quote of any status — the BOM exists regardless of quote status.
  let { data: quote } = await supabase
    .from("quotes")
    .select("id, ref")
    .eq("job_id", jobId)
    .eq("status", "accepted")
    .order("accepted_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!quote) {
    const fallback = await supabase
      .from("quotes")
      .select("id, ref")
      .eq("job_id", jobId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    quote = fallback.data;
  }
  if (!quote) {
    return NextResponse.json({ error: "No quote found for this job to import a BOM from" }, { status: 400 });
  }

  // BOM lines + the catalogue product's asset-type mapping + device_type.
  const { data: lines } = await supabase
    .from("quote_line_items")
    .select("product_name, sku, quantity, quote_products ( name, device_type, asset_type_id )")
    .eq("quote_id", quote.id)
    .order("sort_order", { ascending: true });
  if (!lines || lines.length === 0) {
    return NextResponse.json({ error: "Quote has no line items" }, { status: 400 });
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

  // Aggregate the BOM into per-unit demand, keyed by (name + asset type) so a
  // re-run can top up against what this job already created. Two lines with
  // the same product just add their quantities.
  type Demand = {
    name: string;
    qty: number;
    sku: string | null;
    assetTypeId: string;
    deviceType: string | null;
    manufacturer: string | null;
    model: string | null;
  };
  const demand = new Map<string, Demand>();
  const unmapped: SkippedLine[] = []; // product has no asset-type tag — needs attention
  const consumables: SkippedLine[] = []; // mapped but not trackable — correctly skipped

  for (const li of lines) {
    const prod = (Array.isArray(li.quote_products) ? li.quote_products[0] : li.quote_products) as
      | { name?: string | null; device_type?: string | null; asset_type_id?: string | null }
      | null;
    const name = (li.product_name ?? prod?.name ?? "").trim();
    const qty = Math.max(1, Math.round(Number(li.quantity) || 1));
    if (!name) continue; // garbage line — nothing to report it as

    // Resolve the asset type: product tag wins, else legacy name match.
    const assetTypeId =
      prod?.asset_type_id ??
      typeByName.get(name.toLowerCase()) ??
      typeByName.get((prod?.name ?? "").trim().toLowerCase()) ??
      null;
    const meta = assetTypeId ? metaById.get(assetTypeId) : null;

    if (!assetTypeId || !meta) {
      const existing = unmapped.find((s) => s.name === name);
      if (existing) existing.qty += qty;
      else unmapped.push({ name, qty });
      continue;
    }
    if (!meta.trackable) {
      const existing = consumables.find((s) => s.name === name);
      if (existing) existing.qty += qty;
      else consumables.push({ name, qty });
      continue;
    }

    const key = `${name.toLowerCase()}|${assetTypeId}`;
    const d = demand.get(key);
    if (d) {
      d.qty += qty;
    } else {
      demand.set(key, {
        name,
        qty,
        sku: (li.sku ?? "").trim() || null,
        assetTypeId,
        // Prefer the asset type's name for the device label so the register
        // reads consistently ("Camera" not "Dahua HDW3667 Black"); make/model
        // from the type defaults, model falling back to the BOM SKU so the
        // part # is at least captured.
        deviceType: meta.name ?? prod?.device_type ?? null,
        manufacturer: meta.manufacturer ?? null,
        model: meta.model ?? ((li.sku ?? "").trim() || null),
      });
    }
  }

  // What this job already put in the register, bucketed the same way — the
  // top-up baseline. Never deletes: a shrunk BOM just reports a surplus.
  const { data: existingAssets } = await supabase
    .from("site_assets")
    .select("device_name, asset_type_id")
    .eq("job_id", jobId);
  const existingByKey = new Map<string, number>();
  for (const a of existingAssets ?? []) {
    const key = `${(a.device_name ?? "").trim().toLowerCase()}|${a.asset_type_id ?? ""}`;
    existingByKey.set(key, (existingByKey.get(key) ?? 0) + 1);
  }

  // Manually-added site assets (no job stamp) of the same types — can't be
  // safely deduped against automatically, but the tech deserves a heads-up.
  const demandTypeIds = [...new Set([...demand.values()].map((d) => d.assetTypeId))];
  const possibleDuplicates: Array<{ deviceType: string; count: number }> = [];
  if (demandTypeIds.length > 0) {
    const { data: unstamped } = await supabase
      .from("site_assets")
      .select("asset_type_id")
      .eq("site_id", job.site_id)
      .is("job_id", null)
      .in("asset_type_id", demandTypeIds);
    const byType = new Map<string, number>();
    for (const a of unstamped ?? []) {
      if (!a.asset_type_id) continue;
      byType.set(a.asset_type_id, (byType.get(a.asset_type_id) ?? 0) + 1);
    }
    for (const [typeId, count] of byType) {
      // Only warn when this run is actually about to create that type.
      const creating = [...demand.values()].some((d) => {
        const key = `${d.name.toLowerCase()}|${d.assetTypeId}`;
        return d.assetTypeId === typeId && d.qty > (existingByKey.get(key) ?? 0);
      });
      if (creating) {
        possibleDuplicates.push({
          deviceType: metaById.get(typeId)?.name ?? "Unknown type",
          count,
        });
      }
    }
  }

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
  let alreadyCovered = 0;
  for (const d of demand.values()) {
    const key = `${d.name.toLowerCase()}|${d.assetTypeId}`;
    const have = existingByKey.get(key) ?? 0;
    const need = Math.max(0, d.qty - have);
    alreadyCovered += Math.min(have, d.qty);
    for (let i = 0; i < need && rows.length < MAX_UNITS; i++) {
      rows.push({
        site_id: job.site_id,
        job_id: jobId,
        device_name: d.name,
        device_type: d.deviceType,
        manufacturer: d.manufacturer,
        model: d.model,
        asset_type_id: d.assetTypeId,
        is_active: true,
      });
    }
    if (rows.length >= MAX_UNITS) break;
  }

  if (rows.length === 0 && demand.size === 0) {
    return NextResponse.json(
      {
        error:
          unmapped.length > 0
            ? "No importable devices on this quote — nothing is mapped to a trackable asset type yet. Tag the products on Settings → Products, then run this again."
            : "Nothing to import from this quote — every line is cable, mounts or consumables.",
        unmapped,
        consumables,
      },
      { status: 400 },
    );
  }

  let created = 0;
  if (rows.length > 0) {
    const { data: inserted, error: insErr } = await supabase
      .from("site_assets")
      .insert(rows)
      .select("id");
    if (insErr) return NextResponse.json({ error: insErr.message }, { status: 500 });
    created = inserted?.length ?? 0;
  }

  return NextResponse.json({
    ok: true,
    created,
    alreadyCovered, // units the register already had from this job (top-up dedupe)
    siteId: job.site_id,
    quoteRef: quote.ref,
    capped: rows.length >= MAX_UNITS,
    unmapped, // products with no asset-type tag — the loud part
    consumables, // correctly skipped non-trackable lines
    possibleDuplicates, // same-type manual entries already on the site
  });
}
