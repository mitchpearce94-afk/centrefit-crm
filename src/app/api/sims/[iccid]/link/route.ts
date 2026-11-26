import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { hasPermission, loadCurrentPermissions } from "@/lib/auth/permissions";
import { normalisePhone } from "@/lib/jasper/client";

/**
 * Link / unlink a Jasper SIM (by ICCID) to a CRM site asset. The ICCID lives on
 * site_assets.iccid (unique). Permission: sites.manage_assets.
 *
 *   POST { assetId }                → stamp this asset
 *   POST { siteId, msisdn? }        → reuse the site's unlinked SIM-card asset
 *                                     (serial matching the phone number first),
 *                                     else create one
 *   DELETE                          → clear the ICCID from whichever asset has it
 */
async function guard() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: NextResponse.json({ error: "Not authenticated" }, { status: 401 }) };
  const perms = await loadCurrentPermissions();
  if (!perms || !hasPermission(perms, "sites.manage_assets")) {
    return { error: NextResponse.json({ error: "You don't have permission to manage site assets" }, { status: 403 }) };
  }
  return { supabase };
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ iccid: string }> }) {
  const { iccid } = await params;
  const g = await guard();
  if (g.error) return g.error;
  const supabase = g.supabase!;

  const body = (await req.json().catch(() => ({}))) as { assetId?: string; siteId?: string; msisdn?: string | null };
  const phone = normalisePhone(body.msisdn);

  // Whatever currently carries this ICCID lets go of it first (unique index).
  await supabase.from("site_assets").update({ iccid: null }).eq("iccid", iccid);

  let assetId = body.assetId?.trim() || null;
  let siteId = body.siteId?.trim() || null;

  if (assetId) {
    const { data: asset, error } = await supabase.from("site_assets").select("id, site_id").eq("id", assetId).maybeSingle();
    if (error || !asset) return NextResponse.json({ error: "Asset not found" }, { status: 404 });
    siteId = asset.site_id;
  } else if (siteId) {
    const { data: simType } = await supabase.from("asset_types").select("id").eq("slug", "sim_card").maybeSingle();
    const { data: candidates } = await supabase
      .from("site_assets")
      .select("id, serial, asset_type_id, device_type")
      .eq("site_id", siteId)
      .eq("is_active", true)
      .is("iccid", null)
      .or(simType ? `asset_type_id.eq.${simType.id},device_type.ilike.sim%` : "device_type.ilike.sim%");
    const list = candidates ?? [];
    const byPhone = phone ? list.find((a) => normalisePhone(a.serial) === phone) : undefined;
    const pick = byPhone ?? (list.length === 1 ? list[0] : undefined);
    if (pick) {
      assetId = pick.id;
    } else {
      const { data: created, error } = await supabase
        .from("site_assets")
        .insert({
          site_id: siteId,
          asset_type_id: simType?.id ?? null,
          device_type: "SIM Card",
          device_name: "M2M One SIM",
          serial: phone,
          iccid,
          is_active: true,
        })
        .select("id")
        .single();
      if (error || !created) return NextResponse.json({ error: error?.message ?? "Couldn't add the SIM asset" }, { status: 500 });
      assetId = created.id;
    }
  } else {
    return NextResponse.json({ error: "assetId or siteId required" }, { status: 400 });
  }

  const { error: updErr } = await supabase.from("site_assets").update({ iccid }).eq("id", assetId);
  if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 });

  const { data: site } = await supabase.from("customer_sites").select("name").eq("id", siteId!).maybeSingle();
  return NextResponse.json({ ok: true, assetId, siteId, siteName: site?.name ?? null });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ iccid: string }> }) {
  const { iccid } = await params;
  const g = await guard();
  if (g.error) return g.error;
  const { error } = await g.supabase!.from("site_assets").update({ iccid: null }).eq("iccid", iccid);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
