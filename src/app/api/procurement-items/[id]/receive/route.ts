import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { assetUnitsForProducts, expandUnits, type AssetUnitTemplate } from "@/lib/assets/product-units";

/**
 * Receive a procurement item.
 *
 * GET  → what this line will put on the site asset register, one entry per
 *        physical unit (product quantity × asset units), so the Receive
 *        dialog can ask for each serial. Empty `units` = nothing trackable.
 * POST → mark received (received_at + received_by) AND put the units on the
 *        register (Mitchell 2026-10-19: "when a Veyla product is ordered,
 *        populate the asset list with the server/camera and their SNs"):
 *          - blank shells the BOM→assets import left for this job (same
 *            asset type, no serial, not yet tied to a line) are filled first;
 *          - the rest are inserted new, stamped with this line.
 *        Body: { units?: [{ serial?, mac?, ip? }] } in GET order. No body =
 *        shells with blank serials. Idempotent per line: a second Receive
 *        never adds more assets.
 *
 * Only valid from an awaiting-delivery status: 'ordered' (Xero PO),
 * 'ordered_online' (bought online, no PO), 'in_stock' (pulled from stock).
 */

const RECEIVABLE = ["ordered", "ordered_online", "in_stock"];

interface ItemRow {
  id: string;
  job_id: string;
  product_id: string | null;
  product_name: string;
  quantity: number;
  status: string;
  xero_po_number: string | null;
  order_ref: string | null;
}

async function loadItem(supabase: Awaited<ReturnType<typeof createClient>>, id: string) {
  const { data } = await supabase
    .from("job_procurement_items")
    .select("id, job_id, product_id, product_name, quantity, status, xero_po_number, order_ref")
    .eq("id", id)
    .maybeSingle();
  return (data ?? null) as ItemRow | null;
}

async function unitsForItem(
  supabase: Awaited<ReturnType<typeof createClient>>,
  item: ItemRow,
): Promise<AssetUnitTemplate[]> {
  if (!item.product_id) return [];
  const map = await assetUnitsForProducts(supabase, [item.product_id]);
  const templates = map.get(item.product_id) ?? [];
  return expandUnits(templates, item.quantity);
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const item = await loadItem(supabase, id);
  if (!item) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const { data: job } = await supabase
    .from("jobs")
    .select("site_id, site:customer_sites(name)")
    .eq("id", item.job_id)
    .maybeSingle();
  const siteRaw = (job as { site?: { name: string | null } | { name: string | null }[] | null } | null)?.site;
  const siteName = (Array.isArray(siteRaw) ? siteRaw[0]?.name : siteRaw?.name) ?? null;

  const units = job?.site_id ? await unitsForItem(supabase, item) : [];
  const { count: linked } = await supabase
    .from("site_assets")
    .select("id", { count: "exact", head: true })
    .eq("procurement_item_id", item.id);

  return NextResponse.json({
    item: { id: item.id, status: item.status, quantity: item.quantity, product_name: item.product_name },
    siteId: job?.site_id ?? null,
    siteName,
    alreadyOnRegister: linked ?? 0,
    units: units.map((u, i) => ({
      index: i,
      deviceName: u.deviceName,
      assetTypeId: u.assetTypeId,
      assetTypeName: u.assetTypeName,
      manufacturer: u.manufacturer,
      model: u.model,
      hasSerial: u.hasSerial,
      hasMac: u.hasMac,
      hasIp: u.hasIp,
    })),
  });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  let body: { units?: { serial?: string | null; mac?: string | null; ip?: string | null }[] } = {};
  try {
    const text = await req.text();
    if (text.trim()) body = JSON.parse(text);
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  // Resolve the staff row by email (staff table has no user_id link, only email)
  const { data: staff } = await supabase
    .from("staff")
    .select("id")
    .eq("email", user.email ?? "")
    .maybeSingle();

  const item = await loadItem(supabase, id);
  if (!item) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (!RECEIVABLE.includes(item.status)) {
    return NextResponse.json(
      { error: `Can only receive an awaiting-delivery item (currently ${item.status})` },
      { status: 400 },
    );
  }

  const { data: updated, error } = await supabase
    .from("job_procurement_items")
    .update({
      status: "received",
      received_at: new Date().toISOString(),
      received_by: staff?.id ?? null,
    })
    .eq("id", id)
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // ── Asset register ────────────────────────────────────────────────────
  const assets = { created: 0, filled: 0, skipped: 0, siteId: null as string | null, error: null as string | null };
  try {
    const { data: job } = await supabase.from("jobs").select("site_id").eq("id", item.job_id).maybeSingle();
    if (job?.site_id) {
      assets.siteId = job.site_id;
      const units = await unitsForItem(supabase, item);
      if (units.length > 0) {
        // Idempotency: assets already stamped with this line mean a prior
        // Receive (or an undo → re-receive) already did the work.
        const { count: linked } = await supabase
          .from("site_assets")
          .select("id", { count: "exact", head: true })
          .eq("procurement_item_id", item.id);
        if ((linked ?? 0) > 0) {
          assets.skipped = units.length;
        } else {
          const typeIds = Array.from(new Set(units.map((u) => u.assetTypeId)));
          // Blank shells from the BOM→assets import: same job, same type, no
          // serial yet, not tied to any line. Name match first, then any of
          // the type (the import's own top-up rule).
          const { data: shells } = await supabase
            .from("site_assets")
            .select("id, device_name, asset_type_id")
            .eq("job_id", item.job_id)
            .in("asset_type_id", typeIds)
            .is("serial", null)
            .is("procurement_item_id", null)
            .order("created_at", { ascending: true });
          const pool = [...(shells ?? [])];
          const takeShell = (u: AssetUnitTemplate) => {
            let i = pool.findIndex(
              (s) => s.asset_type_id === u.assetTypeId && (s.device_name ?? "").trim().toLowerCase() === u.deviceName.toLowerCase(),
            );
            if (i < 0) i = pool.findIndex((s) => s.asset_type_id === u.assetTypeId);
            return i < 0 ? null : pool.splice(i, 1)[0];
          };
          const clean = (v: string | null | undefined) => (v ?? "").trim() || null;
          const ref = item.xero_po_number ?? item.order_ref;
          const note = `Received ${new Date().toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric", timeZone: "Australia/Brisbane" })}${ref ? ` on ${ref}` : ""} (${item.product_name})`;
          const inserts: Record<string, unknown>[] = [];
          for (let i = 0; i < units.length; i++) {
            const u = units[i];
            const given = body.units?.[i] ?? {};
            const serial = u.hasSerial ? clean(given.serial) : null;
            const mac = u.hasMac ? clean(given.mac) : null;
            const ip = u.hasIp ? clean(given.ip) : null;
            const shell = takeShell(u);
            if (shell) {
              const patch: Record<string, unknown> = {
                procurement_item_id: item.id,
                manufacturer: u.manufacturer,
                model: u.model,
                device_name: u.deviceName,
              };
              if (serial) patch.serial = serial;
              if (mac) patch.mac_address = mac;
              if (ip) patch.ip_address = ip;
              const { error: upErr } = await supabase.from("site_assets").update(patch).eq("id", shell.id);
              if (upErr) throw upErr;
              assets.filled += 1;
            } else {
              inserts.push({
                site_id: job.site_id,
                job_id: item.job_id,
                procurement_item_id: item.id,
                asset_type_id: u.assetTypeId,
                device_type: u.assetTypeName,
                device_name: u.deviceName,
                manufacturer: u.manufacturer,
                model: u.model,
                serial,
                mac_address: mac,
                ip_address: ip,
                notes: note,
                is_active: true,
              });
            }
          }
          if (inserts.length > 0) {
            const { error: insErr } = await supabase.from("site_assets").insert(inserts);
            if (insErr) throw insErr;
            assets.created = inserts.length;
          }
        }
      }
    }
  } catch (err) {
    // The line IS received; the register is best-effort and reported.
    assets.error = err instanceof Error ? err.message : String(err);
  }

  return NextResponse.json({ item: updated, assets });
}
