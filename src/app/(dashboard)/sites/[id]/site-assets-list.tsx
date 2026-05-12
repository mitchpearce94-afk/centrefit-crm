"use client";

import { useEffect, useRef, useState } from "react";
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

const inputClass =
  "rounded-md border border-border bg-input px-2.5 py-1.5 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary";

export function SiteAssetsList({
  siteId,
  assets,
}: {
  siteId: string;
  assets: SiteAsset[];
}) {
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
      </div>

      <QuickAddRow siteId={siteId} />

      <div className="mt-3 space-y-2">
        {visible.map((a) =>
          editingId === a.id ? (
            <SiteAssetEditForm
              key={a.id}
              siteId={siteId}
              asset={a}
              onDone={() => setEditingId(null)}
            />
          ) : (
            <AssetRow
              key={a.id}
              asset={a}
              onEdit={() => setEditingId(a.id)}
            />
          )
        )}
        {visible.length === 0 && (
          <div className="rounded-lg border border-dashed border-border p-8 text-center">
            <p className="text-sm text-muted-foreground">
              No assets recorded yet. Use the row above to start adding — set the
              device type, then scan or type the serial and press Enter to save
              and queue another.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Quick-add row ────────────────────────────────────────────────────────────
// Always-visible single row at the top of the list. Designed for speed with
// a USB barcode scanner (which acts as a keyboard + Enter): scan into Serial,
// focus auto-advances to MAC; scan into MAC, focus auto-advances to IP; press
// Enter in any of those last three (or click Save) to commit the asset and
// clear only the per-device fields. Device Type / Manufacturer / Model
// persist across saves so installing a batch of the same device just means
// scanning serials.

function QuickAddRow({ siteId }: { siteId: string }) {
  const router = useRouter();
  const supabase = createClient();
  const { toast } = useToast();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // "Sticky" fields — persist across saves so a batch of the same device is fast
  const [deviceType, setDeviceType] = useState("");
  const [manufacturer, setManufacturer] = useState("");
  const [model, setModel] = useState("");
  const [locationNote, setLocationNote] = useState("");

  // "Per-unit" fields — cleared after each save
  const [deviceName, setDeviceName] = useState("");
  const [serial, setSerial] = useState("");
  const [macAddress, setMacAddress] = useState("");
  const [ipAddress, setIpAddress] = useState("");

  const serialRef = useRef<HTMLInputElement>(null);
  const macRef = useRef<HTMLInputElement>(null);
  const ipRef = useRef<HTMLInputElement>(null);

  // Focus Serial on first render so a scanner can fire straight away
  useEffect(() => {
    serialRef.current?.focus();
  }, []);

  async function save() {
    if (!deviceType && !serial && !macAddress && !ipAddress && !deviceName) {
      // Nothing to save
      return;
    }
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
    };
    const { error: err } = await supabase.from("site_assets").insert(payload);
    if (err) {
      setError(err.message);
      setSaving(false);
      return;
    }
    toast(serial.trim() ? `Added · ${serial.trim()}` : "Asset added");
    // Clear per-unit fields, keep sticky ones
    setDeviceName("");
    setSerial("");
    setMacAddress("");
    setIpAddress("");
    setSaving(false);
    router.refresh();
    // Refocus Serial for the next scan
    setTimeout(() => serialRef.current?.focus(), 0);
  }

  function handleSerialKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      // If the device has a MAC field worth filling, jump there; otherwise save
      macRef.current?.focus();
    }
  }
  function handleMacKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      ipRef.current?.focus();
    }
  }
  function handleIpKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      save();
    }
  }

  return (
    <div className="mt-3 rounded-lg border border-primary/30 bg-card p-3 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div className="text-[10px] font-semibold uppercase tracking-wider text-primary">
          Quick add{" "}
          <span className="font-normal text-muted-foreground normal-case tracking-normal">
            — scan or type, press Enter to advance · last field saves the row
          </span>
        </div>
        {(deviceType || manufacturer || model || locationNote) && (
          <button
            type="button"
            onClick={() => {
              setDeviceType("");
              setManufacturer("");
              setModel("");
              setLocationNote("");
            }}
            className="text-[11px] text-muted-foreground hover:text-foreground"
          >
            Clear sticky defaults
          </button>
        )}
      </div>

      {error && <p className="text-xs text-destructive">{error}</p>}

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <select
          value={deviceType}
          onChange={(e) => setDeviceType(e.target.value)}
          className={inputClass}
          aria-label="Device type"
        >
          <option value="">Device type…</option>
          {DEVICE_TYPES.map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>
        <input
          placeholder="Manufacturer (sticky)"
          value={manufacturer}
          onChange={(e) => setManufacturer(e.target.value)}
          className={inputClass}
        />
        <input
          placeholder="Model (sticky)"
          value={model}
          onChange={(e) => setModel(e.target.value)}
          className={inputClass}
        />
        <input
          placeholder="Location (sticky)"
          value={locationNote}
          onChange={(e) => setLocationNote(e.target.value)}
          className={inputClass}
        />
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <input
          placeholder="Friendly name (optional)"
          value={deviceName}
          onChange={(e) => setDeviceName(e.target.value)}
          className={inputClass}
        />
        <input
          ref={serialRef}
          placeholder="Serial #  (scan → Enter)"
          value={serial}
          onChange={(e) => setSerial(e.target.value)}
          onKeyDown={handleSerialKey}
          className={inputClass + " font-mono"}
          autoComplete="off"
          spellCheck={false}
        />
        <input
          ref={macRef}
          placeholder="MAC  (scan → Enter)"
          value={macAddress}
          onChange={(e) => setMacAddress(e.target.value)}
          onKeyDown={handleMacKey}
          className={inputClass + " font-mono"}
          autoComplete="off"
          spellCheck={false}
        />
        <input
          ref={ipRef}
          placeholder="IP  (Enter to save)"
          value={ipAddress}
          onChange={(e) => setIpAddress(e.target.value)}
          onKeyDown={handleIpKey}
          className={inputClass + " font-mono"}
          autoComplete="off"
          spellCheck={false}
        />
      </div>

      <div className="flex gap-2 pt-1">
        <button
          type="button"
          onClick={save}
          disabled={saving}
          className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save & add next"}
        </button>
        <span className="ml-auto text-[11px] text-muted-foreground self-center">
          Sticky: Device Type / Manufacturer / Model / Location stay between saves
        </span>
      </div>
    </div>
  );
}

// ── Existing-asset row (compact view + edit-in-place) ───────────────────────

function AssetRow({ asset, onEdit }: { asset: SiteAsset; onEdit: () => void }) {
  const dim = !asset.is_active ? "opacity-60" : "";
  const headlineParts = [asset.device_name, asset.device_type].filter(Boolean);
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
          {asset.install_date && <span>Installed {formatDate(asset.install_date)}</span>}
          {asset.warranty_expiry && (
            <span className={warrantyClass(asset.warranty_expiry)}>
              Warranty {warrantyLabel(asset.warranty_expiry)}
            </span>
          )}
        </div>
        {asset.notes && (
          <p className="mt-1.5 text-xs text-muted-foreground italic line-clamp-2">{asset.notes}</p>
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

// ── Edit form (existing assets) ─────────────────────────────────────────────

function SiteAssetEditForm({
  siteId,
  asset,
  onDone,
}: {
  siteId: string;
  asset: SiteAsset;
  onDone: () => void;
}) {
  const router = useRouter();
  const supabase = createClient();
  const { toast } = useToast();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmArchive, setConfirmArchive] = useState(false);

  const [deviceType, setDeviceType] = useState(asset.device_type ?? "");
  const [deviceName, setDeviceName] = useState(asset.device_name ?? "");
  const [manufacturer, setManufacturer] = useState(asset.manufacturer ?? "");
  const [model, setModel] = useState(asset.model ?? "");
  const [serial, setSerial] = useState(asset.serial ?? "");
  const [macAddress, setMacAddress] = useState(asset.mac_address ?? "");
  const [ipAddress, setIpAddress] = useState(asset.ip_address ?? "");
  const [locationNote, setLocationNote] = useState(asset.location_note ?? "");
  const [installDate, setInstallDate] = useState(asset.install_date ?? "");
  const [warrantyExpiry, setWarrantyExpiry] = useState(asset.warranty_expiry ?? "");
  const [notes, setNotes] = useState(asset.notes ?? "");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    void siteId;
    const payload = {
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
    const { error: err } = await supabase
      .from("site_assets")
      .update(payload)
      .eq("id", asset.id);
    if (err) {
      setError(err.message);
    } else {
      toast("Asset updated");
      onDone();
      router.refresh();
    }
    setSaving(false);
  }

  async function handleArchiveToggle() {
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
          placeholder="Friendly name"
          value={deviceName}
          onChange={(e) => setDeviceName(e.target.value)}
          className={inputClass}
        />
      </div>

      <div className="grid grid-cols-2 gap-2">
        <input
          placeholder="Manufacturer"
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
          placeholder="Serial"
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
        placeholder="Location note"
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
        placeholder="Notes"
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
          {saving ? "Saving…" : "Update"}
        </button>
        <button
          type="button"
          onClick={onDone}
          className="rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground hover:bg-accent"
        >
          Cancel
        </button>
        {!confirmArchive && (
          <button
            type="button"
            onClick={() => setConfirmArchive(true)}
            className="ml-auto rounded-md px-3 py-1.5 text-xs text-muted-foreground hover:bg-accent"
          >
            {asset.is_active ? "Archive" : "Restore"}
          </button>
        )}
        {confirmArchive && (
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
