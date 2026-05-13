"use client";

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useToast } from "@/components/ui/toast";
import type { AssetType, SiteAsset } from "@/lib/types";

export interface KeyInfoPhoto {
  id: string;
  site_id: string;
  url: string;
  caption: string | null;
  storage_path: string | null;
  uploaded_by: string | null;
  created_at: string;
}

// Legacy device_type strings that should still surface on the Key Info tab
// for sites whose assets pre-date the asset_types table.
const LEGACY_KEY_INFO_TYPES = new Set([
  "Router / Gateway",
  "Network Switch",
  "Wi-Fi Access Point",
  "NVR",
  "WiFi Controller",
]);

export function KeyInfoPanel({
  siteId,
  assets,
  assetTypes,
  photos,
}: {
  siteId: string;
  assets: SiteAsset[];
  assetTypes: AssetType[];
  photos: KeyInfoPhoto[];
}) {
  const typeById = useMemo(() => {
    const m = new Map<string, AssetType>();
    for (const t of assetTypes) m.set(t.id, t);
    return m;
  }, [assetTypes]);

  const keyInfoAssets = useMemo(() => {
    return assets
      .filter((a) => a.is_active)
      .filter((a) => {
        const t = a.asset_type_id ? typeById.get(a.asset_type_id) : null;
        if (t?.is_key_info) return true;
        if (!t && a.device_type && LEGACY_KEY_INFO_TYPES.has(a.device_type)) return true;
        return false;
      });
  }, [assets, typeById]);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-sm font-semibold mb-1">Network &amp; head-end devices</h2>
        <p className="text-xs text-muted-foreground mb-3">
          Read-only summary of the routers, switches, WAPs and NVR at this site. Edit values on the Assets tab.
        </p>
        {keyInfoAssets.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
            No router, switch, WAP or NVR recorded yet. Add them on the Assets tab.
          </div>
        ) : (
          <div className="space-y-3">
            {keyInfoAssets.map((a) => {
              const t = a.asset_type_id ? typeById.get(a.asset_type_id) : null;
              return <KeyInfoCard key={a.id} asset={a} type={t ?? null} />;
            })}
          </div>
        )}
      </div>

      <PhotosSection siteId={siteId} photos={photos} />
    </div>
  );
}

function KeyInfoCard({ asset, type }: { asset: SiteAsset; type: AssetType | null }) {
  const title =
    asset.device_name?.trim() ||
    type?.name ||
    asset.device_type ||
    "Asset";

  const rows: { label: string; value: string | null }[] = [];
  if (asset.serial) rows.push({ label: "Serial", value: asset.serial });
  if (asset.mac_address) rows.push({ label: "MAC", value: asset.mac_address });
  if (asset.ip_address) rows.push({ label: "IP", value: asset.ip_address });
  if (asset.subnet) rows.push({ label: "Subnet", value: asset.subnet });
  if (asset.admin_user) rows.push({ label: "Admin user", value: asset.admin_user });
  if (asset.admin_password) rows.push({ label: "Admin password", value: asset.admin_password });
  if (asset.staff_user) rows.push({ label: "Staff user", value: asset.staff_user });
  if (asset.staff_password) rows.push({ label: "Staff password", value: asset.staff_password });
  if (asset.firmware) rows.push({ label: "Firmware", value: asset.firmware });

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="flex items-center justify-between mb-2 gap-2">
        <div>
          <h3 className="text-sm font-semibold">{title}</h3>
          {type?.name && asset.device_name && (
            <p className="text-[11px] text-muted-foreground">{type.name}</p>
          )}
          {(asset.manufacturer || asset.model) && (
            <p className="text-[11px] text-muted-foreground">
              {[asset.manufacturer, asset.model].filter(Boolean).join(" ")}
            </p>
          )}
        </div>
      </div>
      <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1.5 text-xs">
        {rows.map((row) => (
          <div key={row.label} className="flex items-baseline gap-2">
            <dt className="w-28 shrink-0 text-muted-foreground">{row.label}</dt>
            <dd className="font-mono text-foreground break-all">{row.value}</dd>
          </div>
        ))}
        {rows.length === 0 && (
          <p className="text-muted-foreground italic">No values recorded yet.</p>
        )}
      </dl>

      {Array.isArray(asset.vlans) && asset.vlans.length > 0 && (
        <div className="mt-3 border-t border-border pt-3">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">
            VLANs
          </p>
          <ul className="space-y-1">
            {asset.vlans.map((v, i) => (
              <li key={i} className="text-xs">
                <span className="font-mono">{v.id ?? "—"}</span>{" "}
                <span className="text-muted-foreground">{v.name ?? ""}</span>
                {v.notes && (
                  <span className="text-muted-foreground italic"> · {v.notes}</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {Array.isArray(asset.wifi_ssids) && asset.wifi_ssids.length > 0 && (
        <div className="mt-3 border-t border-border pt-3">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-1.5">
            Wi-Fi
          </p>
          <ul className="space-y-1 text-xs">
            {asset.wifi_ssids.map((w, i) => (
              <li key={i} className="flex gap-3">
                <span className="font-mono">{w.ssid ?? "—"}</span>
                <span className="font-mono text-muted-foreground">{w.password ?? ""}</span>
                {w.notes && (
                  <span className="text-muted-foreground italic"> · {w.notes}</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function PhotosSection({ siteId, photos }: { siteId: string; photos: KeyInfoPhoto[] }) {
  const router = useRouter();
  const supabase = createClient();
  const { toast } = useToast();
  const [uploading, setUploading] = useState(false);
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null);
  const deleteTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    if (files.length === 0) return;
    setUploading(true);
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      for (const file of files) {
        const ext = file.name.split(".").pop();
        const path = `sites/${siteId}/key-info/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
        const { error: uploadErr } = await supabase.storage
          .from("job-attachments")
          .upload(path, file);
        if (uploadErr) {
          toast(uploadErr.message, "error");
          continue;
        }
        const { data: urlData } = supabase.storage.from("job-attachments").getPublicUrl(path);
        const { error: insErr } = await supabase.from("site_key_info_photos").insert({
          site_id: siteId,
          url: urlData.publicUrl,
          caption: file.name,
          storage_path: path,
          uploaded_by: user?.id ?? null,
        });
        if (insErr) toast(insErr.message, "error");
      }
      router.refresh();
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  function handleDeleteClick(photoId: string) {
    if (confirmingDeleteId !== photoId) {
      setConfirmingDeleteId(photoId);
      if (deleteTimer.current) clearTimeout(deleteTimer.current);
      deleteTimer.current = setTimeout(() => setConfirmingDeleteId(null), 4000);
      return;
    }
    if (deleteTimer.current) clearTimeout(deleteTimer.current);
    setConfirmingDeleteId(null);
    void deletePhoto(photoId);
  }

  async function deletePhoto(photoId: string) {
    const photo = photos.find((p) => p.id === photoId);
    if (!photo) return;
    if (photo.storage_path) {
      await supabase.storage.from("job-attachments").remove([photo.storage_path]);
    }
    const { error } = await supabase.from("site_key_info_photos").delete().eq("id", photoId);
    if (error) {
      toast(error.message, "error");
      return;
    }
    router.refresh();
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-2 gap-2">
        <div>
          <h2 className="text-sm font-semibold">Site photos</h2>
          <p className="text-xs text-muted-foreground">
            Server rack, alarm panel, comms cabinet — anything a tech might need to see before going on site.
          </p>
        </div>
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={uploading}
          className="rounded-md border border-primary/30 bg-primary/5 px-3 py-1.5 text-xs font-medium text-primary hover:bg-primary/10 disabled:opacity-50 transition-colors"
        >
          {uploading ? "Uploading…" : "+ Upload photos"}
        </button>
        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          multiple
          onChange={handleUpload}
          className="hidden"
        />
      </div>
      {photos.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
          No photos uploaded yet.
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
          {photos.map((p) => {
            const confirming = confirmingDeleteId === p.id;
            return (
              <div key={p.id} className="relative group">
                <a href={p.url} target="_blank" rel="noopener noreferrer">
                  <img
                    src={p.url}
                    alt={p.caption ?? "Site photo"}
                    className="h-32 w-full rounded-md border border-border object-cover"
                  />
                </a>
                <button
                  type="button"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    handleDeleteClick(p.id);
                  }}
                  className={`absolute top-1.5 right-1.5 rounded-md text-white shadow ring-1 ring-white/10 transition-all ${
                    confirming
                      ? "bg-destructive px-2 py-1 text-[10px] font-semibold"
                      : "bg-destructive/80 hover:bg-destructive p-1 text-xs"
                  }`}
                >
                  {confirming ? "Tap to confirm" : "×"}
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
