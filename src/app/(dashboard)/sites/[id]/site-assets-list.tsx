"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useToast } from "@/components/ui/toast";
import type { AssetType, SiteAsset } from "@/lib/types";

const inputClass =
  "rounded-md border border-border bg-input px-2.5 py-1.5 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary";

export function SiteAssetsList({
  siteId,
  assets,
  assetTypes,
}: {
  siteId: string;
  assets: SiteAsset[];
  assetTypes: AssetType[];
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

      <QuickAddRow siteId={siteId} assetTypes={assetTypes} />

      <div className="mt-3 space-y-2">
        {visible.map((a) =>
          editingId === a.id ? (
            <SiteAssetEditForm
              key={a.id}
              siteId={siteId}
              asset={a}
              assetTypes={assetTypes}
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

function QuickAddRow({ siteId, assetTypes }: { siteId: string; assetTypes: AssetType[] }) {
  const router = useRouter();
  const supabase = createClient();
  const { toast } = useToast();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // "Sticky" fields — persist across saves so a batch of the same device is fast
  const [assetTypeId, setAssetTypeId] = useState("");
  const [manufacturer, setManufacturer] = useState("");
  const [model, setModel] = useState("");
  const [locationNote, setLocationNote] = useState("");

  const selectedType = useMemo(
    () => assetTypes.find((t) => t.id === assetTypeId) ?? null,
    [assetTypes, assetTypeId],
  );

  // When picking a type, auto-fill manufacturer if it has a default and the
  // user hasn't typed one yet. Doesn't override user input.
  useEffect(() => {
    if (selectedType?.default_manufacturer && !manufacturer) {
      setManufacturer(selectedType.default_manufacturer);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedType]);

  // "Per-unit" fields — cleared after each save
  const [deviceName, setDeviceName] = useState("");
  const [serial, setSerial] = useState("");
  const [macAddress, setMacAddress] = useState("");
  const [ipAddress, setIpAddress] = useState("");
  const [subnet, setSubnet] = useState("");
  const [adminUser, setAdminUser] = useState("");
  const [adminPassword, setAdminPassword] = useState("");
  const [staffUser, setStaffUser] = useState("");
  const [staffPassword, setStaffPassword] = useState("");
  const [firmware, setFirmware] = useState("");
  const [vlans, setVlans] = useState<{ id?: string; name?: string; notes?: string }[]>([]);
  const [wifiSsids, setWifiSsids] = useState<{ ssid?: string; password?: string; notes?: string }[]>([]);

  const serialRef = useRef<HTMLInputElement>(null);
  const macRef = useRef<HTMLInputElement>(null);
  const ipRef = useRef<HTMLInputElement>(null);

  // Focus Serial on first render so a scanner can fire straight away
  useEffect(() => {
    serialRef.current?.focus();
  }, []);

  async function save() {
    if (!assetTypeId && !serial && !macAddress && !ipAddress && !deviceName) {
      // Nothing to save
      return;
    }
    setSaving(true);
    setError(null);
    const payload = {
      site_id: siteId,
      asset_type_id: assetTypeId || null,
      device_type: selectedType?.name ?? null,
      device_name: deviceName.trim() || null,
      manufacturer: manufacturer.trim() || null,
      model: model.trim() || null,
      serial: serial.trim() || null,
      mac_address: macAddress.trim() || null,
      ip_address: ipAddress.trim() || null,
      subnet: subnet.trim() || null,
      admin_user: adminUser.trim() || null,
      admin_password: adminPassword.trim() || null,
      staff_user: staffUser.trim() || null,
      staff_password: staffPassword.trim() || null,
      firmware: firmware.trim() || null,
      vlans,
      wifi_ssids: wifiSsids,
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
    setSubnet("");
    setAdminUser("");
    setAdminPassword("");
    setStaffUser("");
    setStaffPassword("");
    setFirmware("");
    setVlans([]);
    setWifiSsids([]);
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
        {(assetTypeId || manufacturer || model || locationNote) && (
          <button
            type="button"
            onClick={() => {
              setAssetTypeId("");
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
          value={assetTypeId}
          onChange={(e) => setAssetTypeId(e.target.value)}
          className={inputClass}
          aria-label="Device type"
        >
          <option value="">Device type…</option>
          {assetTypes.map((t) => (
            <option key={t.id} value={t.id}>{t.name}</option>
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

      {(selectedType?.has_network_credentials || selectedType?.has_firmware) && (
        <div className="rounded-md border border-border bg-muted/30 p-3 space-y-2">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Network &amp; credentials
          </p>
          <div className="grid grid-cols-2 gap-2">
            <input
              placeholder="Subnet (e.g. 192.168.1.0/24)"
              value={subnet}
              onChange={(e) => setSubnet(e.target.value)}
              className={inputClass + " font-mono"}
            />
            <input
              placeholder="Firmware"
              value={firmware}
              onChange={(e) => setFirmware(e.target.value)}
              className={inputClass}
            />
          </div>
          {selectedType?.has_network_credentials && (
            <div className="grid grid-cols-2 gap-2">
              <input
                placeholder="Admin user"
                value={adminUser}
                onChange={(e) => setAdminUser(e.target.value)}
                className={inputClass}
              />
              <input
                placeholder="Admin password"
                value={adminPassword}
                onChange={(e) => setAdminPassword(e.target.value)}
                className={inputClass + " font-mono"}
              />
            </div>
          )}
          {selectedType?.has_staff_credentials && (
            <div className="grid grid-cols-2 gap-2">
              <input
                placeholder="Staff user"
                value={staffUser}
                onChange={(e) => setStaffUser(e.target.value)}
                className={inputClass}
              />
              <input
                placeholder="Staff password"
                value={staffPassword}
                onChange={(e) => setStaffPassword(e.target.value)}
                className={inputClass + " font-mono"}
              />
            </div>
          )}
        </div>
      )}

      {selectedType?.has_vlans && (
        <RepeatList
          title="VLANs"
          rows={vlans.map((v) => ({ id: v.id ?? "", name: v.name ?? "", notes: v.notes ?? "" }))}
          fields={[
            { key: "id", placeholder: "VLAN ID" },
            { key: "name", placeholder: "Name" },
            { key: "notes", placeholder: "Notes" },
          ]}
          onChange={(rows) => setVlans(rows as { id: string; name: string; notes: string }[])}
        />
      )}

      {selectedType?.has_wifi && (
        <RepeatList
          title="Wi-Fi SSIDs"
          rows={wifiSsids.map((w) => ({ ssid: w.ssid ?? "", password: w.password ?? "", notes: w.notes ?? "" }))}
          fields={[
            { key: "ssid", placeholder: "SSID" },
            { key: "password", placeholder: "Password" },
            { key: "notes", placeholder: "Notes" },
          ]}
          onChange={(rows) =>
            setWifiSsids(rows as { ssid: string; password: string; notes: string }[])
          }
        />
      )}

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
  assetTypes,
  onDone,
}: {
  siteId: string;
  asset: SiteAsset;
  assetTypes: AssetType[];
  onDone: () => void;
}) {
  const router = useRouter();
  const supabase = createClient();
  const { toast } = useToast();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmArchive, setConfirmArchive] = useState(false);

  // Legacy assets (pre-2026-05-13) have asset_type_id=null but a free-text
  // device_type. Map that to the new asset_types row so the extended fields
  // surface automatically — otherwise the form looks identical to the old one.
  const initialAssetTypeId = useMemo(() => {
    if (asset.asset_type_id) return asset.asset_type_id;
    if (!asset.device_type) return "";
    const match = assetTypes.find(
      (t) => t.name.toLowerCase() === asset.device_type!.toLowerCase(),
    );
    return match?.id ?? "";
  }, [asset.asset_type_id, asset.device_type, assetTypes]);
  const [assetTypeId, setAssetTypeId] = useState(initialAssetTypeId);
  const [deviceName, setDeviceName] = useState(asset.device_name ?? "");
  const [manufacturer, setManufacturer] = useState(asset.manufacturer ?? "");
  const [model, setModel] = useState(asset.model ?? "");
  const [serial, setSerial] = useState(asset.serial ?? "");
  const [macAddress, setMacAddress] = useState(asset.mac_address ?? "");
  const [ipAddress, setIpAddress] = useState(asset.ip_address ?? "");
  const [subnet, setSubnet] = useState(asset.subnet ?? "");
  const [adminUser, setAdminUser] = useState(asset.admin_user ?? "");
  const [adminPassword, setAdminPassword] = useState(asset.admin_password ?? "");
  const [staffUser, setStaffUser] = useState(asset.staff_user ?? "");
  const [staffPassword, setStaffPassword] = useState(asset.staff_password ?? "");
  const [firmware, setFirmware] = useState(asset.firmware ?? "");
  const [vlans, setVlans] = useState<{ name?: string; id?: string; notes?: string }[]>(
    Array.isArray(asset.vlans) ? asset.vlans : [],
  );
  const [wifiSsids, setWifiSsids] = useState<{ ssid?: string; password?: string; notes?: string }[]>(
    Array.isArray(asset.wifi_ssids) ? asset.wifi_ssids : [],
  );
  const [locationNote, setLocationNote] = useState(asset.location_note ?? "");
  const [installDate, setInstallDate] = useState(asset.install_date ?? "");
  const [warrantyExpiry, setWarrantyExpiry] = useState(asset.warranty_expiry ?? "");
  const [notes, setNotes] = useState(asset.notes ?? "");

  const selectedType = useMemo(
    () => assetTypes.find((t) => t.id === assetTypeId) ?? null,
    [assetTypes, assetTypeId],
  );

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    void siteId;
    const payload = {
      asset_type_id: assetTypeId || null,
      device_type: selectedType?.name ?? asset.device_type ?? null,
      device_name: deviceName.trim() || null,
      manufacturer: manufacturer.trim() || null,
      model: model.trim() || null,
      serial: serial.trim() || null,
      mac_address: macAddress.trim() || null,
      ip_address: ipAddress.trim() || null,
      subnet: subnet.trim() || null,
      admin_user: adminUser.trim() || null,
      admin_password: adminPassword.trim() || null,
      staff_user: staffUser.trim() || null,
      staff_password: staffPassword.trim() || null,
      firmware: firmware.trim() || null,
      vlans,
      wifi_ssids: wifiSsids,
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
          value={assetTypeId}
          onChange={(e) => setAssetTypeId(e.target.value)}
          className={inputClass}
        >
          <option value="">Device type…</option>
          {assetTypes.map((t) => (
            <option key={t.id} value={t.id}>{t.name}</option>
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

      {(selectedType?.has_network_credentials || selectedType?.has_firmware) && (
        <div className="rounded-md border border-border bg-muted/30 p-3 space-y-2">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Network &amp; credentials
          </p>
          <div className="grid grid-cols-2 gap-2">
            <input
              placeholder="Subnet (e.g. 192.168.1.0/24)"
              value={subnet}
              onChange={(e) => setSubnet(e.target.value)}
              className={inputClass + " font-mono"}
            />
            <input
              placeholder="Firmware"
              value={firmware}
              onChange={(e) => setFirmware(e.target.value)}
              className={inputClass}
            />
          </div>
          {selectedType?.has_network_credentials && (
            <div className="grid grid-cols-2 gap-2">
              <input
                placeholder="Admin user"
                value={adminUser}
                onChange={(e) => setAdminUser(e.target.value)}
                className={inputClass}
              />
              <input
                placeholder="Admin password"
                value={adminPassword}
                onChange={(e) => setAdminPassword(e.target.value)}
                className={inputClass + " font-mono"}
              />
            </div>
          )}
          {selectedType?.has_staff_credentials && (
            <div className="grid grid-cols-2 gap-2">
              <input
                placeholder="Staff user"
                value={staffUser}
                onChange={(e) => setStaffUser(e.target.value)}
                className={inputClass}
              />
              <input
                placeholder="Staff password"
                value={staffPassword}
                onChange={(e) => setStaffPassword(e.target.value)}
                className={inputClass + " font-mono"}
              />
            </div>
          )}
        </div>
      )}

      {selectedType?.has_vlans && (
        <RepeatList
          title="VLANs"
          rows={vlans.map((v) => ({
            id: v.id ?? "",
            name: v.name ?? "",
            notes: v.notes ?? "",
          }))}
          fields={[
            { key: "id", placeholder: "VLAN ID" },
            { key: "name", placeholder: "Name" },
            { key: "notes", placeholder: "Notes" },
          ]}
          onChange={(rows) => setVlans(rows as { id: string; name: string; notes: string }[])}
        />
      )}

      {selectedType?.has_wifi && (
        <RepeatList
          title="Wi-Fi SSIDs"
          rows={wifiSsids.map((w) => ({
            ssid: w.ssid ?? "",
            password: w.password ?? "",
            notes: w.notes ?? "",
          }))}
          fields={[
            { key: "ssid", placeholder: "SSID" },
            { key: "password", placeholder: "Password" },
            { key: "notes", placeholder: "Notes" },
          ]}
          onChange={(rows) =>
            setWifiSsids(rows as { ssid: string; password: string; notes: string }[])
          }
        />
      )}

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

// ── Generic repeating-list editor used for VLANs / Wi-Fi SSIDs ──────────────

function RepeatList({
  title,
  rows,
  fields,
  onChange,
}: {
  title: string;
  rows: Record<string, string>[];
  fields: { key: string; placeholder: string }[];
  onChange: (rows: Record<string, string>[]) => void;
}) {
  function update(idx: number, key: string, value: string) {
    const next = rows.map((r, i) => (i === idx ? { ...r, [key]: value } : r));
    onChange(next);
  }
  function add() {
    onChange([...rows, fields.reduce((acc, f) => ({ ...acc, [f.key]: "" }), {})]);
  }
  function remove(idx: number) {
    onChange(rows.filter((_, i) => i !== idx));
  }

  return (
    <div className="rounded-md border border-border bg-muted/30 p-3 space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          {title}
        </p>
        <button
          type="button"
          onClick={add}
          className="text-[11px] font-medium text-primary hover:text-primary/80"
        >
          + Add
        </button>
      </div>
      {rows.length === 0 ? (
        <p className="text-[11px] text-muted-foreground italic">None — tap + Add to start.</p>
      ) : (
        <div className="space-y-1.5">
          {rows.map((row, idx) => (
            <div key={idx} className="flex items-center gap-1.5">
              {fields.map((f) => (
                <input
                  key={f.key}
                  placeholder={f.placeholder}
                  value={row[f.key] ?? ""}
                  onChange={(e) => update(idx, f.key, e.target.value)}
                  className={inputClass + " flex-1 font-mono"}
                />
              ))}
              <button
                type="button"
                onClick={() => remove(idx)}
                className="rounded-md border border-border px-2 py-1 text-[11px] text-muted-foreground hover:text-destructive hover:border-destructive"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
