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

// Downscale a photo in the browser before upload so Key Info stays snappy —
// full-res phone shots were making the tab lag (Michael, 2026-06-04). Caps the
// longest edge at 1600px and re-encodes JPEG. Returns null (upload original)
// for non-images, already-small files, or formats the browser can't decode
// (e.g. some HEIC) so we never block an upload on the resize.
async function downscaleImage(file: File, maxEdge = 1600, quality = 0.82): Promise<Blob | null> {
  if (!file.type.startsWith("image/")) return null;
  if (file.size < 600_000) return null; // already small enough to leave alone
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
    const w = Math.max(1, Math.round(bitmap.width * scale));
    const h = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      bitmap.close?.();
      return null;
    }
    ctx.drawImage(bitmap, 0, 0, w, h);
    bitmap.close?.();
    return await new Promise<Blob | null>((resolve) =>
      canvas.toBlob((b) => resolve(b), "image/jpeg", quality),
    );
  } catch {
    return null; // unsupported format — fall back to uploading the original
  }
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

// Infrastructure sections, in tech-priority order. Keyed by asset_types.category;
// legacy device_type strings all belong to data/cctv.
const CATEGORY_SECTIONS: Array<{ key: string; label: string }> = [
  { key: "data", label: "Network & Data" },
  { key: "cctv", label: "CCTV" },
  { key: "security", label: "Security & Alarms" },
  { key: "access", label: "Access Control" },
  { key: "duress", label: "Duress" },
  { key: "audio", label: "Audio" },
  { key: "av", label: "AV" },
  { key: "other", label: "Other" },
];

export function KeyInfoPanel({
  siteId,
  assets,
  assetTypes,
  photos,
  notes,
}: {
  siteId: string;
  assets: SiteAsset[];
  assetTypes: AssetType[];
  photos: KeyInfoPhoto[];
  notes: string | null;
}) {
  const typeById = useMemo(() => {
    const m = new Map<string, AssetType>();
    for (const t of assetTypes) m.set(t.id, t);
    return m;
  }, [assetTypes]);

  // Key-info assets bucketed by infrastructure category — Mitchell's 07-03
  // ask: "separated by their infrastructure", not one flat pile. Wi-Fi is
  // pulled OUT into its own aggregate box (07-05): each "Wi-Fi Network" asset
  // is really just an SSID+password pair, and rendering them as device cards
  // made them "look like another device almost".
  const { sections, wifiEntries } = useMemo(() => {
    const buckets = new Map<string, Array<{ asset: SiteAsset; type: AssetType | null }>>();
    const wifi: Array<{ ssid: string; password: string | null; notes: string | null; source: string | null }> = [];
    for (const a of assets) {
      if (!a.is_active) continue;
      const t = a.asset_type_id ? typeById.get(a.asset_type_id) ?? null : null;
      const isKeyInfo = t?.is_key_info || (!t && a.device_type && LEGACY_KEY_INFO_TYPES.has(a.device_type));
      if (!isKeyInfo) continue;

      // Dedicated Wi-Fi networks: contribute SSID rows, never a device card.
      if (t?.slug === "wifi_network") {
        const rows = Array.isArray(a.wifi_ssids) && a.wifi_ssids.length > 0
          ? a.wifi_ssids
          : a.device_name
            ? [{ ssid: a.device_name, password: null as string | null, notes: null as string | null }]
            : [];
        for (const w of rows) {
          if (!w.ssid) continue;
          wifi.push({ ssid: w.ssid, password: w.password ?? null, notes: w.notes ?? null, source: null });
        }
        continue;
      }

      // Real devices keep their card; any SSIDs they carry (router / controller
      // configs) surface in the Wi-Fi box, tagged with where they came from.
      if (Array.isArray(a.wifi_ssids)) {
        for (const w of a.wifi_ssids) {
          if (!w.ssid) continue;
          wifi.push({
            ssid: w.ssid,
            password: w.password ?? null,
            notes: w.notes ?? null,
            source: a.device_name?.trim() || t?.name || a.device_type || null,
          });
        }
      }

      const cat = t?.category ?? (a.device_type === "NVR" ? "cctv" : "data");
      if (!buckets.has(cat)) buckets.set(cat, []);
      buckets.get(cat)!.push({ asset: a, type: t });
    }
    // Dedupe identical SSID+password pairs (same network configured on both a
    // Wi-Fi Network asset and a router config).
    const seen = new Set<string>();
    const deduped = wifi.filter((w) => {
      const k = `${w.ssid} ${w.password ?? ""}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    }).sort((a, b) => a.ssid.localeCompare(b.ssid));

    // Stable order inside a section: asset-type sort order, then device name.
    for (const list of buckets.values()) {
      list.sort(
        (x, y) =>
          (x.type?.sort_order ?? 999) - (y.type?.sort_order ?? 999) ||
          (x.asset.device_name ?? "").localeCompare(y.asset.device_name ?? ""),
      );
    }
    const known = CATEGORY_SECTIONS.filter((s) => buckets.has(s.key)).map((s) => ({
      ...s,
      entries: buckets.get(s.key)!,
    }));
    // Categories we don't know about yet still render (defensive).
    const extras = [...buckets.keys()]
      .filter((k) => !CATEGORY_SECTIONS.some((s) => s.key === k))
      .map((k) => ({ key: k, label: k.toUpperCase(), entries: buckets.get(k)! }));
    return { sections: [...known, ...extras], wifiEntries: deduped };
  }, [assets, typeById]);

  const isEmpty = sections.length === 0 && wifiEntries.length === 0;

  return (
    <div className="space-y-6">
      <NotesSection siteId={siteId} initialNotes={notes} />

      {isEmpty ? (
        <div className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
          No key-info devices recorded yet. Add them on the Assets tab.
        </div>
      ) : (
        <>
          {/* Wi-Fi box leads if there's no Network & Data section to anchor after. */}
          {wifiEntries.length > 0 && !sections.some((s) => s.key === "data") && (
            <WifiSection siteId={siteId} entries={wifiEntries} />
          )}
          {sections.map((section) => (
            <div key={section.key} className="space-y-6">
              <div>
                <div className="flex items-baseline gap-2 mb-2">
                  <h2 className="text-sm font-semibold">{section.label}</h2>
                  <span className="text-[11px] text-muted-foreground">
                    {section.entries.length} device{section.entries.length === 1 ? "" : "s"} · edit on the Assets tab
                  </span>
                </div>
                <div className="space-y-3">
                  {section.entries.map(({ asset, type }) => (
                    <KeyInfoCard key={asset.id} asset={asset} type={type} />
                  ))}
                </div>
              </div>
              {section.key === "data" && wifiEntries.length > 0 && (
                <WifiSection siteId={siteId} entries={wifiEntries} />
              )}
            </div>
          ))}
        </>
      )}

      <PhotosSection siteId={siteId} photos={photos} />
    </div>
  );
}

/**
 * Free-text block at the top of Key Info — alarm codes, ISP account numbers,
 * "the NVR is in the cleaner's cupboard" — anything without an asset field.
 */
function NotesSection({ siteId, initialNotes }: { siteId: string; initialNotes: string | null }) {
  const router = useRouter();
  const supabase = createClient();
  const { toast } = useToast();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(initialNotes ?? "");
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    const { error } = await supabase
      .from("customer_sites")
      .update({ key_info_notes: draft.trim() || null, updated_at: new Date().toISOString() })
      .eq("id", siteId);
    setSaving(false);
    if (error) {
      toast(error.message, "error");
      return;
    }
    toast("Key info notes saved");
    setEditing(false);
    router.refresh();
  }

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="flex items-center justify-between gap-2 mb-2">
        <h2 className="text-sm font-semibold">Site notes</h2>
        {!editing && (
          <div className="flex items-center gap-2">
            {initialNotes && <CopyButton value={initialNotes} label="site notes" />}
            <button
              type="button"
              onClick={() => {
                setDraft(initialNotes ?? "");
                setEditing(true);
              }}
              className="text-xs text-primary hover:underline"
            >
              {initialNotes ? "Edit" : "+ Add notes"}
            </button>
          </div>
        )}
      </div>
      {editing ? (
        <div className="space-y-2">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={Math.min(14, Math.max(4, draft.split("\n").length + 1))}
            autoFocus
            placeholder={"Anything a tech needs that doesn't fit a device field — alarm codes, ISP details, where the rack lives…"}
            className="w-full rounded-md border border-border bg-input px-3 py-2 text-sm font-mono focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
          />
          <div className="flex gap-2">
            <button
              type="button"
              onClick={save}
              disabled={saving}
              className="rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {saving ? "Saving…" : "Save"}
            </button>
            <button
              type="button"
              onClick={() => setEditing(false)}
              className="rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground hover:bg-accent"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : initialNotes ? (
        <pre className="whitespace-pre-wrap break-words font-mono text-xs text-foreground leading-relaxed">{initialNotes}</pre>
      ) : (
        <p className="text-xs text-muted-foreground italic">
          Nothing here yet — codes, ISP details, access instructions, anything a tech should know.
        </p>
      )}
    </div>
  );
}

function CopyButton({ value, label }: { value: string; label?: string }) {
  const { toast } = useToast();
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      aria-label={`Copy${label ? ` ${label}` : ""}`}
      title={`Copy${label ? ` ${label}` : ""}`}
      onClick={async (e) => {
        e.preventDefault();
        e.stopPropagation();
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1200);
        } catch {
          toast("Couldn't copy to clipboard", "error");
        }
      }}
      className="shrink-0 rounded p-0.5 text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
    >
      {copied ? (
        <svg className="h-3.5 w-3.5 text-emerald-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="20 6 9 17 4 12" /></svg>
      ) : (
        <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg>
      )}
    </button>
  );
}

/**
 * All the site's Wi-Fi in ONE box — SSIDs + passwords side by side, whether
 * they came from "Wi-Fi Network" assets or a router/controller config.
 */
function WifiSection({
  siteId,
  entries,
}: {
  siteId: string;
  entries: Array<{ ssid: string; password: string | null; notes: string | null; source: string | null }>;
}) {
  const copyAll = entries
    .map((w) => `${w.ssid}${w.password ? `  ${w.password}` : ""}${w.notes ? `  (${w.notes})` : ""}`)
    .join("\n");
  return (
    <div>
      <div className="flex items-baseline gap-2 mb-2">
        <h2 className="text-sm font-semibold">Wi-Fi</h2>
        <span className="text-[11px] text-muted-foreground">
          {entries.length} network{entries.length === 1 ? "" : "s"} · edit on the Assets tab
        </span>
      </div>
      <div className="rounded-lg border border-border bg-card p-4">
        <div className="flex items-center justify-between mb-2 gap-2">
          <h3 className="text-sm font-semibold">Networks</h3>
          <CopyAllButton value={copyAll} />
        </div>
        <div className="divide-y divide-border/60">
          {entries.map((w, i) => (
            <div key={i} className="flex flex-wrap items-baseline gap-x-6 gap-y-1 py-2 first:pt-0 last:pb-0">
              <div className="flex min-w-0 items-center gap-1.5">
                <span className="w-16 shrink-0 text-xs text-muted-foreground">SSID</span>
                <span className="font-mono text-xs font-medium break-all">{w.ssid}</span>
                <CopyButton value={w.ssid} label="SSID" />
              </div>
              {w.password && (
                <div className="flex min-w-0 items-center gap-1.5">
                  <span className="w-16 shrink-0 text-xs text-muted-foreground">Password</span>
                  <span className="font-mono text-xs break-all">{w.password}</span>
                  <CopyButton value={w.password} label="Wi-Fi password" />
                </div>
              )}
              {(w.notes || w.source) && (
                <span className="text-[11px] italic text-muted-foreground">
                  {[w.notes, w.source ? `via ${w.source}` : null].filter(Boolean).join(" · ")}
                </span>
              )}
              {w.password && (
                <a
                  href={`/api/sites/${siteId}/wifi-poster?ssid=${encodeURIComponent(w.ssid)}`}
                  target="_blank"
                  rel="noreferrer"
                  title="Print-ready poster with a scan-to-join QR — members connect without seeing the password"
                  className="ml-auto rounded-md border border-border px-2 py-0.5 text-[11px] text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                >
                  QR poster
                </a>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function CopyAllButton({ value }: { value: string }) {
  const { toast } = useToast();
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1200);
        } catch {
          toast("Couldn't copy to clipboard", "error");
        }
      }}
      className="shrink-0 rounded-md border border-border px-2 py-1 text-[11px] text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
    >
      {copied ? "Copied ✓" : "Copy all"}
    </button>
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
  if (Array.isArray(asset.extra_staff_users)) {
    asset.extra_staff_users.forEach((u, i) => {
      if (u.user) rows.push({ label: `Staff user ${i + 2}`, value: u.user });
      if (u.password) rows.push({ label: `Staff password ${i + 2}`, value: u.password });
    });
  }
  if (asset.firmware) rows.push({ label: "Firmware", value: asset.firmware });

  // One-click block for pasting into a ticket or handover doc — the "easy to
  // copy" half of Mitchell's 07-03 suggestion.
  const copyAllText = [
    [title, type?.name && asset.device_name ? `(${type.name})` : null, asset.manufacturer, asset.model]
      .filter(Boolean)
      .join(" "),
    ...rows.map((r) => `${r.label}: ${r.value}`),
    ...(Array.isArray(asset.vlans) && asset.vlans.length > 0
      ? ["VLANs:", ...asset.vlans.map((v) => `  ${v.id ?? "—"} ${v.name ?? ""}${v.notes ? ` · ${v.notes}` : ""}`)]
      : []),
  ].join("\n");

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
        {rows.length > 0 && <CopyAllButton value={copyAllText} />}
      </div>
      <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1.5 text-xs">
        {rows.map((row) => (
          <div key={row.label} className="flex items-baseline gap-2">
            <dt className="w-28 shrink-0 text-muted-foreground">{row.label}</dt>
            <dd className="font-mono text-foreground break-all flex items-center gap-1.5">
              <span className="break-all">{row.value}</span>
              {row.value && <CopyButton value={row.value} label={row.label} />}
            </dd>
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

      {/* Wi-Fi deliberately NOT rendered here — all SSIDs live in the
          dedicated Wi-Fi box above (Mitchell, 2026-07-05). */}
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
        const resized = await downscaleImage(file);
        const body: Blob = resized ?? file;
        const ext = resized ? "jpg" : (file.name.split(".").pop() || "jpg");
        const path = `sites/${siteId}/key-info/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
        const { error: uploadErr } = await supabase.storage
          .from("job-attachments")
          .upload(path, body, { contentType: resized ? "image/jpeg" : file.type || undefined });
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
