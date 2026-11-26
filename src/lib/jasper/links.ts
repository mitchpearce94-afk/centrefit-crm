// Joins Jasper SIMs to CRM site assets. The link is `site_assets.iccid`; when
// no link exists yet we suggest the SIM-card asset whose serial (historically
// the SIM's phone number) matches the Jasper MSISDN.

import type { SupabaseClient } from "@supabase/supabase-js";
import { normalisePhone, type JasperDevice } from "./client";

export interface SimAsset {
  id: string;
  siteId: string;
  siteName: string;
  customerName: string | null;
  serial: string | null;
  deviceName: string | null;
  iccid: string | null;
}

export interface SiteOption {
  id: string;
  name: string;
  customerName: string | null;
}

interface RawAssetRow {
  id: string;
  site_id: string;
  serial: string | null;
  device_name: string | null;
  iccid: string | null;
  customer_sites: { name: string; customer: { name: string } | null } | null;
}

/** Active SIM-card assets (by type, or anything already carrying an ICCID). */
export async function loadSimAssets(supabase: SupabaseClient): Promise<SimAsset[]> {
  const { data: types } = await supabase.from("asset_types").select("id").eq("slug", "sim_card");
  const typeIds = (types ?? []).map((t: { id: string }) => t.id);
  const orParts = ["iccid.not.is.null", "device_type.ilike.sim%"];
  if (typeIds.length) orParts.push(`asset_type_id.in.(${typeIds.join(",")})`);
  const { data, error } = await supabase
    .from("site_assets")
    .select("id, site_id, serial, device_name, iccid, customer_sites(name, customer:customers!customer_id(name))")
    .eq("is_active", true)
    .or(orParts.join(","));
  if (error) throw new Error(error.message);
  return ((data ?? []) as unknown as RawAssetRow[]).map((r) => ({
    id: r.id,
    siteId: r.site_id,
    siteName: r.customer_sites?.name ?? "Unknown site",
    customerName: r.customer_sites?.customer?.name ?? null,
    serial: r.serial,
    deviceName: r.device_name,
    iccid: r.iccid,
  }));
}

export async function loadSiteOptions(supabase: SupabaseClient): Promise<SiteOption[]> {
  const { data } = await supabase
    .from("customer_sites")
    .select("id, name, customer:customers!customer_id(name)")
    .order("name");
  return ((data ?? []) as unknown as Array<{ id: string; name: string; customer: { name: string } | null }>).map((s) => ({
    id: s.id,
    name: s.name,
    customerName: s.customer?.name ?? null,
  }));
}

export interface SimLinkState {
  linked: SimAsset | null;
  /** Unlinked SIM asset whose serial matches the MSISDN — one tap to confirm. */
  suggested: SimAsset | null;
}

export function resolveLinks(devices: JasperDevice[], assets: SimAsset[]): Map<string, SimLinkState> {
  const byIccid = new Map<string, SimAsset>();
  const byPhone = new Map<string, SimAsset[]>();
  for (const a of assets) {
    if (a.iccid) byIccid.set(a.iccid, a);
    const phone = normalisePhone(a.serial);
    if (phone && !a.iccid) byPhone.set(phone, [...(byPhone.get(phone) ?? []), a]);
  }
  const out = new Map<string, SimLinkState>();
  for (const d of devices) {
    const linked = byIccid.get(d.iccid) ?? null;
    let suggested: SimAsset | null = null;
    if (!linked) {
      const phone = normalisePhone(d.msisdn);
      const candidates = phone ? byPhone.get(phone) ?? [] : [];
      if (candidates.length === 1) suggested = candidates[0];
    }
    out.set(d.iccid, { linked, suggested });
  }
  return out;
}
