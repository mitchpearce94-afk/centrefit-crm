"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useToast } from "@/components/ui/toast";
import type { SiteAsset } from "@/lib/types";

const DEVICE_TYPES = [
  "Camera",
  "NVR",
  "Network Switch",
  "Router / Gateway",
  "Wi-Fi Access Point",
  "Comms Rack / Cabinet",
  "Alarm Panel",
  "Motion Sensor",
  "Reed Switch",
  "Duress Button",
  "Duress Pendant / Receiver",
  "Light & Siren",
  "Access Controller",
  "Card Reader",
  "Standalone Keypad",
  "Door Strike / Mag Lock",
  "REX Button",
  "Speaker",
  "Amplifier",
  "Modulator",
  "TV / Display",
  "TV Mount",
  "Cardio Distribution",
  "Tailgate System",
  "Nightlife Component",
  "Other",
] as const;

export function SiteAssetsList({
  siteId,
  assets,
}: {
  siteId: string;
  assets: SiteAsset[];
}) {
  const [showAdd, setShowAdd] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);

  const visible = showArchived ? assets : assets.filter((a) => a.is_active);
  const archivedCount = assets.filter((a) => !a.is_active).length;

  return (
    <div>
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-muted-foreground">
          Site assets ({visible.length}
          {archivedCount > 0 ? ` · ${archivedCount} archived` : ""})
        </h2>
        <div className="flex items-center gap-3">
          {archivedCount > 0 && (
            <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <input
                type="checkbox"
                checked={showArchived}
                onChange={(e) => setShowArchived(e.target.checked)}
                className="rounded border-border"
              />
              Show archived
            </label>
          )}
          <button
            onClick={() => {
              setShowAdd(true);
              setEditingId(null);
            }}
            className="text-sm text-primary hover:text-primary/80 transition-colors"
          >
            + Add asset
          </button>
        </div>
      </div>

      {showAdd && !editingId && (
        <SiteAssetForm siteId={siteId} onDone={() => setShowAdd(false)} />
      )}

      <div className="mt-3 space-y-2">
        {visible.map((a) =>
          editingId === a.id ? (
            <SiteAssetForm
              key={a.id}
              siteId={siteId}
              asset={a}
              onDone={() => setEditingId(null)}
            />
          ) : (
            <AssetRow
              key={a.id}
              asset={a}
              onEdit={() => {
                setEditingId(a.id);
                setShowAdd(false);
              }}
            />
          )
        )}
        {visible.length === 0 && !showAdd && (
          <div className="rounded-lg border border-dashed border-border p-8 text-center">
            <p className="text-sm text-muted-foreground">
              No assets recorded yet. Add cameras, switches, alarm panels, or any
              gear installed at this site — useful when a tech needs to look up a
              serial or check a warranty mid-call.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

function AssetRow({ asset, onEdit }: { asset: SiteAsset; onEdit: () => void }) {
  const dim = !asset.is_active ? "opacity-60" : "";
  const headlineParts = [
    asset.device_name,
    asset.device_type,
  ].filter(Boolean);
  const headline = headlineParts.length > 0 ? headlineParts.join(" — ") : "(unnamed asset)";

  return (
    <div
      className={`flex items-start justify-between rounded-lg border border-border bg-card p-3 ${dim}`}
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-medium text-foreground">{headline}</span>
          {!asset.is_active && (
            <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
              Archived
            </span>
          )}
        </div>
        <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
          {asset.manufacturer && asset.model && (
            <span>{asset.manufacturer} {asset.model}</span>
          )}
          {asset.manufacturer && !asset.model && <span>{asset.manufacturer}</span>}
          {!asset.manufacturer && asset.model && <span>{asset.model}</span>}
          {asset.serial && (
            <span>
              <span className="text-muted-foreground/70">SN </span>
              <span className="font-mono">{asset.serial}</span>
            </span>
          )}
          {asset.mac_address && (
            <span>
              <span className="text-muted-foreground/70">MAC </span>
              <span className="font-mono">{asset.mac_address}</span>
            </span>
          )}
          {asset.ip_address && (
            <span>
              <span className="text-muted-foreground/70">IP </span>
              <span className="font-mono">{asset.ip_address}</span>
            </span>
          )}
          {asset.location_note && <span>📍 {asset.location_note}</span>}
        </div>
        <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
          {asset.install_date && (
            <span>Installed {formatDate(asset.install_date)}</span>
          )}
          {asset.warranty_expiry && (
            <span className={warrantyClass(asset.warranty_expiry)}>
              Warranty {warrantyLabel(asset.warranty_expiry)}
            </span>
          )}
        </div>
        {asset.notes && (
          <p className="mt-1.5 text-xs text-muted-foreground italic line-clamp-2">
            {asset.notes}
          </p>
        )}
      </div>
      <button
        onClick={onEdit}
        className="text-xs text-muted-foreground hover:text-foreground transition-colors px-2 py-1"
      >
        Edit
      </button>
    </div>
  );
}

function formatDate(d: string): string {
  return new Date(d + "T00:00:00").toLocaleDateString("en-AU", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function warrantyLabel(d: string): string {
  const exp = new Date(d + "T00:00:00");
  const now = new Date();
  const diffDays = Math.round((exp.getTime() - now.getTime()) / 86_400_000);
  if (diffDays < 0) return `expired ${formatDate(d)}`;
  if (diffDays === 0) return "expires today";
  if (diffDays <= 60) return `expires ${formatDate(d)} (${diffDays}d)`;
  return `to ${formatDate(d)}`;
}

function warrantyClass(d: string): string {
  const exp = new Date(d + "T00:00:00").getTime();
  const now = Date.now();
  const days = (exp - now) / 86_400_000;
  if (days < 0) return "text-destructive";
  if (days <= 60) return "text-warning";
  return "text-muted-foreground";
}

function SiteAssetForm({
  siteId,
  asset,
  onDone,
}: {
  siteId: string;
  asset?: SiteAsset;
  onDone: () => void;
}) {
  const router = useRouter();
  const supabase = createClient();
  const { toast } = useToast();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmArchive, setConfirmArchive] = useState(false);

  const [deviceType, setDeviceType] = useState(asset?.device_type ?? "");
  const [deviceName, setDeviceName] = useState(asset?.device_name ?? "");
  const [manufacturer, setManufacturer] = useState(asset?.manufacturer ?? "");
  const [model, setModel] = useState(asset?.model ?? "");
  const [serial, setSerial] = useState(asset?.serial ?? "");
  const [macAddress, setMacAddress] = useState(asset?.mac_address ?? "");
  const [ipAddress, setIpAddress] = useState(asset?.ip_address ?? "");
  const [locationNote, setLocationNote] = useState(asset?.location_note ?? "");
  const [installDate, setInstallDate] = useState(asset?.install_date ?? "");
  const [warrantyExpiry, setWarrantyExpiry] = useState(asset?.warranty_expiry ?? "");
  const [notes, setNotes] = useState(asset?.notes ?? "");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);

    const payload = {
      site_id: siteId,
      device_type: deviceType.trim() || null,
      device_name: deviceName.trim() || null,
      manufacturer: manufacturer.trim() || null,
      model: model.trim() || null,
      serial: serial.trim() || null,
      mac_address: macAddress.trim() || null,
      ip_address: ipAddress.trim() || null,
      location_note: locationNote.trim() || null,
      install_date: installDate || null,
      warranty_expiry: warrantyExpiry || null,
      notes: notes.trim() || null,
    };

    const result = asset
      ? await supabase.from("site_assets").update(payload).eq("id", asset.id)
      : await supabase.from("site_assets").insert(payload);

    if (result.error) {
      setError(result.error.message);
    } else {
      toast(asset ? "Asset updated" : "Asset added");
      onDone();
      router.refresh();
    }
    setSaving(false);
  }

  async function handleArchiveToggle() {
    if (!asset) return;
    const { error: err } = await supabase
      .from("site_assets")
      .update({ is_active: !asset.is_active })
      .eq("id", asset.id);
    if (err) {
      setError(err.message);
    } else {
      toast(asset.is_active ? "Asset archived" : "Asset restored");
      onDone();
      router.refresh();
    }
  }

  const inputClass =
    "rounded-md border border-border bg-input px-2.5 py-1.5 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary";

  return (
    <form
      onSubmit={handleSubmit}
      className="mt-2 rounded-lg border border-primary/30 bg-card p-3 space-y-2"
    >
      {error && <p className="text-xs text-destructive">{error}</p>}

      <div className="grid grid-cols-2 gap-2">
        <select
          value={deviceType}
          onChange={(e) => setDeviceType(e.target.value)}
          className={inputClass}
        >
          <option value="">Device type…</option>
          {DEVICE_TYPES.map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>
        <input
          placeholder="Friendly name (e.g. 'Front entry cam')"
          value={deviceName}
          onChange={(e) => setDeviceName(e.target.value)}
          className={inputClass}
        />
      </div>

      <div className="grid grid-cols-2 gap-2">
        <input
          placeholder="Manufacturer (e.g. Dahua, Bosch)"
          value={manufacturer}
          onChange={(e) => setManufacturer(e.target.value)}
          className={inputClass}
        />
        <input
          placeholder="Model"
          value={model}
          onChange={(e) => setModel(e.target.value)}
          className={inputClass}
        />
      </div>

      <div className="grid grid-cols-3 gap-2">
        <input
          placeholder="Serial #"
          value={serial}
          onChange={(e) => setSerial(e.target.value)}
          className={inputClass + " font-mono"}
        />
        <input
          placeholder="MAC"
          value={macAddress}
          onChange={(e) => setMacAddress(e.target.value)}
          className={inputClass + " font-mono"}
        />
        <input
          placeholder="IP"
          value={ipAddress}
          onChange={(e) => setIpAddress(e.target.value)}
          className={inputClass + " font-mono"}
        />
      </div>

      <input
        placeholder="Location note (e.g. 'Ceiling above front desk', 'Rack pos 3')"
        value={locationNote}
        onChange={(e) => setLocationNote(e.target.value)}
        className={inputClass + " w-full"}
      />

      <div className="grid grid-cols-2 gap-2">
        <label className="flex flex-col gap-1">
          <span className="text-[11px] uppercase tracking-wider text-muted-foreground">
            Install date
          </span>
          <input
            type="date"
            value={installDate}
            onChange={(e) => setInstallDate(e.target.value)}
            className={inputClass}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[11px] uppercase tracking-wider text-muted-foreground">
            Warranty expiry
          </span>
          <input
            type="date"
            value={warrantyExpiry}
            onChange={(e) => setWarrantyExpiry(e.target.value)}
            className={inputClass}
          />
        </label>
      </div>

      <textarea
        placeholder="Notes (firmware version, replacement history, anything worth knowing)"
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        rows={2}
        className={inputClass + " w-full resize-none"}
      />

      <div className="flex gap-2 pt-1">
        <button
          type="submit"
          disabled={saving}
          className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          {saving ? "Saving…" : asset ? "Update" : "Add asset"}
        </button>
        <button
          type="button"
          onClick={onDone}
          className="rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground hover:bg-accent"
        >
          Cancel
        </button>
        {asset && !confirmArchive && (
          <button
            type="button"
            onClick={() => setConfirmArchive(true)}
            className="ml-auto rounded-md px-3 py-1.5 text-xs text-muted-foreground hover:bg-accent"
          >
            {asset.is_active ? "Archive" : "Restore"}
          </button>
        )}
        {asset && confirmArchive && (
          <div className="ml-auto flex gap-1">
            <button
              type="button"
              onClick={handleArchiveToggle}
              className="rounded-md bg-muted px-3 py-1.5 text-xs text-foreground hover:bg-accent"
            >
              {asset.is_active ? "Confirm archive" : "Confirm restore"}
            </button>
            <button
              type="button"
              onClick={() => setConfirmArchive(false)}
              className="rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground hover:bg-accent"
            >
              No
            </button>
          </div>
        )}
      </div>
    </form>
  );
}
