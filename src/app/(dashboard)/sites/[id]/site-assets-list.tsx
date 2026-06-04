"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useToast } from "@/components/ui/toast";
import type { AssetType, SiteAsset } from "@/lib/types";
import { ImportBomToAssetsButton } from "../../jobs/[id]/import-bom-to-assets-button";

const inputClass =
  "rounded-md border border-border bg-input px-2.5 py-1.5 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary";

// Password generator — Mitchell's rules:
//  - 12 chars
//  - At least one lowercase, uppercase, digit, special
//  - Exclude ambiguous glyphs: i, I, l (lower), 0, o, O, j (lower)
// Crypto.getRandomValues for unbiased selection (no Math.random).
const PWD_LOWER = "abcdefghkmnpqrstuvwxyz";       // no i, j, l, o
const PWD_UPPER = "ABCDEFGHJKLMNPQRSTUVWXYZ";     // no I, O
const PWD_DIGITS = "123456789";                    // no 0
const PWD_SPECIAL = "!@#$%^&*-_+=";
const PWD_ALL = PWD_LOWER + PWD_UPPER + PWD_DIGITS + PWD_SPECIAL;
const PWD_LENGTH = 12;

// Rejection-sampled random int in [0, max). Avoids modulo bias.
function randomInt(max: number): number {
  const buf = new Uint32Array(1);
  const limit = Math.floor(0xffffffff / max) * max;
  for (;;) {
    crypto.getRandomValues(buf);
    if (buf[0] < limit) return buf[0] % max;
  }
}
function pickFrom(pool: string): string {
  return pool.charAt(randomInt(pool.length));
}

function generatePassword(): string {
  const chars: string[] = [
    pickFrom(PWD_LOWER),
    pickFrom(PWD_UPPER),
    pickFrom(PWD_DIGITS),
    pickFrom(PWD_SPECIAL),
  ];
  while (chars.length < PWD_LENGTH) chars.push(pickFrom(PWD_ALL));
  // Fisher-Yates shuffle so the guaranteed-category chars aren't pinned to
  // the first four positions.
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join("");
}

function GeneratePasswordButton({
  onGenerate,
  title = "Generate strong password",
}: {
  onGenerate: (password: string) => void;
  title?: string;
}) {
  return (
    <button
      type="button"
      onClick={() => onGenerate(generatePassword())}
      title={title}
      aria-label={title}
      className="shrink-0 rounded-md border border-border bg-input px-2 py-1.5 text-[11px] text-muted-foreground hover:text-foreground hover:border-primary/40 transition-colors"
    >
      ⟳
    </button>
  );
}

export function SiteAssetsList({
  siteId,
  assets,
  assetTypes,
  isAdmin,
  importJobId,
}: {
  siteId: string;
  assets: SiteAsset[];
  assetTypes: AssetType[];
  isAdmin: boolean;
  importJobId: string | null;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const supabase = createClient();
  const { toast } = useToast();

  // Inline (spreadsheet-style) save of a single identifier field. No refresh —
  // the value is already in the input, so we avoid the focus jump / jank that
  // a router.refresh would cause while the tech tabs through rows.
  async function saveField(
    assetId: string,
    field: "serial" | "mac_address" | "ip_address" | "rfid",
    value: string,
  ) {
    const { error } = await supabase
      .from("site_assets")
      .update({ [field]: value.trim() || null })
      .eq("id", assetId);
    if (error) toast(error.message, "error");
  }

  const visible = showArchived ? assets : assets.filter((a) => a.is_active);
  const archivedCount = assets.filter((a) => !a.is_active).length;

  // Headline counts — Cameras (any cctv "Camera" type) and PIRs (security
  // type whose slug contains "pir"). Counted across active assets only so
  // archived units don't inflate the install count.
  const activeAssets = assets.filter((a) => a.is_active);
  const typeById = new Map(assetTypes.map((t) => [t.id, t]));
  let cameraCount = 0;
  let pirCount = 0;
  for (const a of activeAssets) {
    const t = a.asset_type_id ? typeById.get(a.asset_type_id) : null;
    const isCamera =
      (t && t.category === "cctv" && /camera/i.test(t.name)) ||
      (!t && (a.device_type ?? "").toLowerCase().includes("camera"));
    const isPir =
      (t && t.category === "security" && /pir/i.test(t.slug)) ||
      (!t && /\bpir\b/i.test(a.device_type ?? ""));
    if (isCamera) cameraCount++;
    if (isPir) pirCount++;
  }

  // Group assets by category for display (#8) so they read in tidy sections
  // instead of one long list. Wi-Fi network entries collapse into a single
  // "Wi-Fi Details" group rather than scattering as separate boxes (#9).
  // Unknown categories fold into "Other".
  const CATEGORY_ORDER: { key: string; label: string }[] = [
    { key: "security", label: "Security" },
    { key: "cctv", label: "CCTV" },
    { key: "access", label: "Access Control" },
    { key: "data", label: "Data & Network" },
    { key: "wifi", label: "Wi-Fi Details" },
    { key: "av", label: "Audio Visual" },
    { key: "audio", label: "Audio" },
    { key: "other", label: "Other" },
  ];
  const knownCats = new Set(CATEGORY_ORDER.map((c) => c.key));
  const groupKeyFor = (a: (typeof visible)[number]): string => {
    const t = a.asset_type_id ? typeById.get(a.asset_type_id) : null;
    const isWifiNetwork =
      !!t?.has_wifi &&
      !a.serial &&
      !a.ip_address &&
      !a.mac_address &&
      Array.isArray(a.wifi_ssids) &&
      a.wifi_ssids.length > 0;
    if (isWifiNetwork) return "wifi";
    const cat = t?.category ?? "other";
    return knownCats.has(cat) ? cat : "other";
  };
  const groupedAssets = new Map<string, typeof visible>();
  for (const a of visible) {
    const k = groupKeyFor(a);
    const arr = groupedAssets.get(k);
    if (arr) arr.push(a);
    else groupedAssets.set(k, [a]);
  }

  return (
    <div>
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h2 className="text-sm font-semibold text-muted-foreground">
          Site assets ({visible.length}
          {archivedCount > 0 ? ` · ${archivedCount} archived` : ""})
        </h2>
        <div className="flex items-center gap-2 flex-wrap">
          <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
            Cameras <span className="text-foreground">{cameraCount}</span>
          </span>
          <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
            PIRs <span className="text-foreground">{pirCount}</span>
          </span>
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
          {importJobId && <ImportBomToAssetsButton jobId={importJobId} />}
        </div>
      </div>

      <QuickAddRow siteId={siteId} assetTypes={assetTypes} />

      <div className="mt-3 space-y-5">
        {visible.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border p-8 text-center">
            <p className="text-sm text-muted-foreground">
              No assets recorded yet. Use the row above to start adding — set the
              device type, then scan or type the serial and press Enter to save
              and queue another.
            </p>
          </div>
        ) : (
          CATEGORY_ORDER.filter((c) => groupedAssets.has(c.key)).map((cat) => {
            const rows = groupedAssets.get(cat.key)!;
            const header = (
              <h3 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                {cat.label} <span className="text-foreground/40">({rows.length})</span>
              </h3>
            );

            // Wi-Fi networks don't have serial/MAC/IP per row — keep the card
            // view (it shows SSID/password) and the full edit form.
            if (cat.key === "wifi") {
              return (
                <div key={cat.key}>
                  {header}
                  <div className="space-y-2">
                    {rows.map((a) =>
                      editingId === a.id ? (
                        <SiteAssetEditForm key={a.id} siteId={siteId} asset={a} assetTypes={assetTypes} isAdmin={isAdmin} onDone={() => setEditingId(null)} />
                      ) : (
                        <AssetRow key={a.id} asset={a} onEdit={() => setEditingId(a.id)} />
                      )
                    )}
                  </div>
                </div>
              );
            }

            // Spreadsheet view — only show MAC/IP/RFID columns the group uses.
            const showMac = rows.some((a) => a.asset_type_id && typeById.get(a.asset_type_id)?.has_mac);
            const showIp = rows.some((a) => a.asset_type_id && typeById.get(a.asset_type_id)?.has_ip);
            const showRfid = rows.some((a) => a.asset_type_id && typeById.get(a.asset_type_id)?.has_rfid);
            const colSpan = 3 + (showMac ? 1 : 0) + (showIp ? 1 : 0) + (showRfid ? 1 : 0) + 1;
            return (
              <div key={cat.key}>
                {header}
                <div className="overflow-x-auto rounded-lg border border-border">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-border bg-muted/40 text-left text-muted-foreground">
                        <th className="px-2 py-2 font-medium">Device</th>
                        <th className="px-2 py-2 font-medium hidden sm:table-cell w-40">Make / Model</th>
                        <th className="px-2 py-2 font-medium">Serial</th>
                        {showMac && <th className="px-2 py-2 font-medium">MAC</th>}
                        {showIp && <th className="px-2 py-2 font-medium">IP</th>}
                        {showRfid && <th className="px-2 py-2 font-medium">RFID</th>}
                        <th className="px-2 py-2 font-medium text-right w-12"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((a) =>
                        editingId === a.id ? (
                          <tr key={a.id}>
                            <td colSpan={colSpan} className="p-0">
                              <SiteAssetEditForm siteId={siteId} asset={a} assetTypes={assetTypes} isAdmin={isAdmin} onDone={() => setEditingId(null)} />
                            </td>
                          </tr>
                        ) : (
                          <EditableAssetRow
                            key={a.id}
                            asset={a}
                            type={a.asset_type_id ? typeById.get(a.asset_type_id) ?? null : null}
                            showMac={showMac}
                            showIp={showIp}
                            showRfid={showRfid}
                            onEdit={() => setEditingId(a.id)}
                            onSaveField={saveField}
                          />
                        )
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            );
          })
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

  // Wi-Fi-only types (has_wifi but no serial/mac/ip/creds/firmware/vlans/rfid)
  // get a streamlined SSID + password capture instead of the full device
  // form. Each Enter-to-save creates one asset per network so a tech can
  // bang through "office", "guest", "staff" wifi names in three keystrokes
  // each. Mitchell flagged 2026-05-27.
  const isWifiOnly = !!(
    selectedType &&
    selectedType.has_wifi &&
    !selectedType.has_serial &&
    !selectedType.has_mac &&
    !selectedType.has_ip &&
    !selectedType.has_network_credentials &&
    !selectedType.has_firmware &&
    !selectedType.has_vlans &&
    !selectedType.has_rfid
  );

  // When the device type CHANGES, refresh manufacturer / model to the new
  // type's defaults. We remember the defaults we last auto-filled so we can
  // tell an auto-filled value apart from one the tech typed by hand: if the
  // current field still holds the previous type's default (or is blank) we
  // replace it; if the tech overrode it, we leave their value alone.
  // (Bug: switching HDD → NVR used to leave the make/model stuck on the HDD
  // defaults — Michael, 2026-06-04.)
  const lastDefaults = useRef<{ manufacturer: string; model: string }>({ manufacturer: "", model: "" });
  useEffect(() => {
    const newMfr = selectedType?.default_manufacturer ?? "";
    const newModel = selectedType?.default_model ?? "";
    setManufacturer((cur) => (cur === "" || cur === lastDefaults.current.manufacturer ? newMfr : cur));
    setModel((cur) => (cur === "" || cur === lastDefaults.current.model ? newModel : cur));
    lastDefaults.current = { manufacturer: newMfr, model: newModel };
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
  const [rfid, setRfid] = useState("");
  const [vlans, setVlans] = useState<{ id?: string; name?: string; notes?: string }[]>([]);
  const [wifiSsids, setWifiSsids] = useState<{ ssid?: string; password?: string; notes?: string }[]>([]);
  // Wi-Fi-only inline fields (one row per network). Stored as wifi_ssids[0]
  // on save so the underlying schema doesn't fork.
  const [wifiSsid, setWifiSsid] = useState("");
  const [wifiPassword, setWifiPassword] = useState("");

  const serialRef = useRef<HTMLInputElement>(null);
  const macRef = useRef<HTMLInputElement>(null);
  const ipRef = useRef<HTMLInputElement>(null);
  const wifiSsidRef = useRef<HTMLInputElement>(null);

  // Focus Serial on first render so a scanner can fire straight away.
  // preventScroll keeps the page where the user left it — without it, the
  // QuickAdd row at the top of the list yanks the page to the top after
  // every save (and on initial mount), which Michael flagged as the
  // friendly-name scroll-jump bug.
  useEffect(() => {
    serialRef.current?.focus({ preventScroll: true });
  }, []);

  async function save() {
    // Wi-Fi-only mode: require at least an SSID; everything else is optional.
    // Non-wifi mode: require at least one of the device fields filled.
    if (isWifiOnly) {
      if (!wifiSsid.trim()) return;
    } else if (!assetTypeId && !serial && !macAddress && !ipAddress && !deviceName) {
      return;
    }
    setSaving(true);
    setError(null);
    const effectiveWifiSsids = isWifiOnly
      ? [{ ssid: wifiSsid.trim(), password: wifiPassword.trim() }]
      : wifiSsids;
    const payload = {
      site_id: siteId,
      asset_type_id: assetTypeId || null,
      device_type: selectedType?.name ?? null,
      // For wifi-only assets the "friendly name" is the SSID so the row in
      // the list reads "Office Wi-Fi — Wi-Fi Network" instead of "(unnamed)".
      device_name: isWifiOnly
        ? wifiSsid.trim() || null
        : deviceName.trim() || null,
      manufacturer: isWifiOnly ? null : manufacturer.trim() || null,
      model: isWifiOnly ? null : model.trim() || null,
      serial: isWifiOnly ? null : serial.trim() || null,
      mac_address: isWifiOnly ? null : macAddress.trim() || null,
      ip_address: isWifiOnly ? null : ipAddress.trim() || null,
      subnet: isWifiOnly ? null : subnet.trim() || null,
      admin_user: isWifiOnly ? null : adminUser.trim() || null,
      admin_password: isWifiOnly ? null : adminPassword.trim() || null,
      staff_user: isWifiOnly ? null : staffUser.trim() || null,
      staff_password: isWifiOnly ? null : staffPassword.trim() || null,
      firmware: isWifiOnly ? null : firmware.trim() || null,
      rfid: isWifiOnly ? null : rfid.trim() || null,
      vlans: isWifiOnly ? [] : vlans,
      wifi_ssids: effectiveWifiSsids,
      location_note: isWifiOnly ? null : locationNote.trim() || null,
    };
    const { error: err } = await supabase.from("site_assets").insert(payload);
    if (err) {
      setError(err.message);
      setSaving(false);
      return;
    }
    toast(
      isWifiOnly
        ? `Added · ${wifiSsid.trim()}`
        : serial.trim() ? `Added · ${serial.trim()}` : "Asset added",
    );
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
    setRfid("");
    setVlans([]);
    setWifiSsids([]);
    setWifiSsid("");
    setWifiPassword("");
    setSaving(false);
    router.refresh();
    // Refocus the right input for the next entry — preventScroll stops the
    // page from jumping to the top of the list. In wifi-only mode the SSID
    // input is the natural next focus; otherwise the Serial scanner field.
    setTimeout(() => {
      if (isWifiOnly) {
        wifiSsidRef.current?.focus({ preventScroll: true });
      } else {
        serialRef.current?.focus({ preventScroll: true });
      }
    }, 0);
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

      {/* Device-type picker is always visible — it's how the user switches
          into wifi-only mode. Sticky meta fields collapse when wifi-only
          since they don't apply to a Wi-Fi network row. */}
      <div className={`grid gap-2 ${isWifiOnly ? "" : "grid-cols-2 sm:grid-cols-4"}`}>
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
        {!isWifiOnly && (
          <>
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
          </>
        )}
      </div>

      {isWifiOnly ? (
        <div className="grid grid-cols-2 gap-2">
          <input
            ref={wifiSsidRef}
            placeholder="SSID  (Tab to password)"
            value={wifiSsid}
            onChange={(e) => setWifiSsid(e.target.value)}
            className={inputClass + " font-mono"}
            autoComplete="off"
            spellCheck={false}
          />
          <div className="flex gap-1.5">
            <input
              placeholder="Password  (Enter to save)"
              value={wifiPassword}
              onChange={(e) => setWifiPassword(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  save();
                }
              }}
              className={inputClass + " flex-1 min-w-0 font-mono"}
              autoComplete="off"
              spellCheck={false}
            />
            <GeneratePasswordButton onGenerate={setWifiPassword} />
          </div>
        </div>
      ) : (
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
      )}

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
              <div className="flex gap-1.5">
                <input
                  placeholder="Admin password"
                  value={adminPassword}
                  onChange={(e) => setAdminPassword(e.target.value)}
                  className={inputClass + " flex-1 min-w-0 font-mono"}
                />
                <GeneratePasswordButton onGenerate={setAdminPassword} />
              </div>
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
              <div className="flex gap-1.5">
                <input
                  placeholder="Staff password"
                  value={staffPassword}
                  onChange={(e) => setStaffPassword(e.target.value)}
                  className={inputClass + " flex-1 min-w-0 font-mono"}
                />
                <GeneratePasswordButton onGenerate={setStaffPassword} />
              </div>
            </div>
          )}
        </div>
      )}

      {selectedType?.has_rfid && (
        <input
          placeholder="RFID number"
          value={rfid}
          onChange={(e) => setRfid(e.target.value)}
          className={inputClass + " w-full font-mono"}
          autoComplete="off"
          spellCheck={false}
        />
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

      {/* The multi-SSID repeating list is for devices that host multiple
          networks (routers, controllers). Wi-Fi-only mode uses the inline
          SSID/password row above instead — one Wi-Fi network per row. */}
      {selectedType?.has_wifi && !isWifiOnly && (
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

// ── Editable spreadsheet row — inline serial/MAC/IP/RFID, autosave on blur ──

function EditableAssetRow({
  asset,
  type,
  showMac,
  showIp,
  showRfid,
  onEdit,
  onSaveField,
}: {
  asset: SiteAsset;
  type: AssetType | null;
  showMac: boolean;
  showIp: boolean;
  showRfid: boolean;
  onEdit: () => void;
  onSaveField: (
    assetId: string,
    field: "serial" | "mac_address" | "ip_address" | "rfid",
    value: string,
  ) => void;
}) {
  const dim = !asset.is_active ? "opacity-60" : "";
  const headline =
    [asset.device_name, asset.device_type].filter(Boolean).join(" — ") || "(unnamed)";
  const makeModel = [asset.manufacturer, asset.model].filter(Boolean).join(" ") || "—";

  // Legacy assets (no type) still allow a serial; otherwise honour the type's
  // capability flags so we don't invite a MAC on a device that hasn't got one.
  function fieldCell(
    field: "serial" | "mac_address" | "ip_address" | "rfid",
    supported: boolean,
    current: string | null | undefined,
  ) {
    if (!supported) return <span className="text-muted-foreground/30">—</span>;
    return (
      <input
        defaultValue={current ?? ""}
        onBlur={(e) => {
          if (e.target.value !== (current ?? "")) onSaveField(asset.id, field, e.target.value);
        }}
        autoComplete="off"
        spellCheck={false}
        className="w-full min-w-[7rem] rounded border border-border bg-input px-2 py-1 font-mono text-xs text-foreground focus:border-primary focus:outline-none"
      />
    );
  }

  return (
    <tr className={`border-b border-border last:border-0 align-middle ${dim}`}>
      <td className="px-2 py-1.5">
        <div className="font-medium text-foreground">{headline}</div>
        {!asset.is_active && <span className="text-[10px] text-muted-foreground">Archived</span>}
      </td>
      <td className="px-2 py-1.5 hidden sm:table-cell text-muted-foreground">{makeModel}</td>
      <td className="px-2 py-1.5">{fieldCell("serial", !type || type.has_serial, asset.serial)}</td>
      {showMac && <td className="px-2 py-1.5">{fieldCell("mac_address", !!type?.has_mac, asset.mac_address)}</td>}
      {showIp && <td className="px-2 py-1.5">{fieldCell("ip_address", !!type?.has_ip, asset.ip_address)}</td>}
      {showRfid && <td className="px-2 py-1.5">{fieldCell("rfid", !!type?.has_rfid, asset.rfid)}</td>}
      <td className="px-2 py-1.5 text-right">
        <button onClick={onEdit} className="text-xs text-muted-foreground hover:text-foreground transition-colors">
          Edit
        </button>
      </td>
    </tr>
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
          {asset.rfid && (
            <span>
              <span className="text-muted-foreground/70">RFID </span>
              <span className="font-mono">{asset.rfid}</span>
            </span>
          )}
          {Array.isArray(asset.wifi_ssids) && asset.wifi_ssids.length > 0 && (
            asset.wifi_ssids.map((w, i) => (
              <span key={i}>
                <span className="text-muted-foreground/70">SSID </span>
                <span className="font-mono">{w.ssid}</span>
                {w.password && (
                  <>
                    {" "}
                    <span className="text-muted-foreground/70">/ </span>
                    <span className="font-mono">{w.password}</span>
                  </>
                )}
              </span>
            ))
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
  isAdmin,
  onDone,
}: {
  siteId: string;
  asset: SiteAsset;
  assetTypes: AssetType[];
  isAdmin: boolean;
  onDone: () => void;
}) {
  const router = useRouter();
  const supabase = createClient();
  const { toast } = useToast();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmArchive, setConfirmArchive] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

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
  const [rfid, setRfid] = useState(asset.rfid ?? "");
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

  // Auto-fill make/model from the device type's defaults when the field is
  // still blank — same as Quick Add. Lets Michael pick a type on a blank
  // (or BOM-imported) shell and have make/model populate without typing.
  // Never overwrites a value already on the asset.
  useEffect(() => {
    if (selectedType?.default_manufacturer && !manufacturer) {
      setManufacturer(selectedType.default_manufacturer);
    }
    if (selectedType?.default_model && !model) {
      setModel(selectedType.default_model);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedType]);

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
      rfid: rfid.trim() || null,
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

  // Hard delete — admin-only (RLS: site_assets_delete USING is_admin()).
  // .select() lets us catch the silent RLS no-op (0 rows, no error) and tell
  // the user instead of pretending it worked. Archive remains the soft option.
  async function handleDelete() {
    setSaving(true);
    setError(null);
    const { data: deleted, error: err } = await supabase
      .from("site_assets")
      .delete()
      .eq("id", asset.id)
      .select("id");
    if (err) {
      setError(err.message);
      setSaving(false);
      return;
    }
    if (!deleted || deleted.length === 0) {
      setError("You don't have permission to delete assets — archive it instead.");
      setSaving(false);
      return;
    }
    toast("Asset deleted");
    onDone();
    router.refresh();
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
              <div className="flex gap-1.5">
                <input
                  placeholder="Admin password"
                  value={adminPassword}
                  onChange={(e) => setAdminPassword(e.target.value)}
                  className={inputClass + " flex-1 min-w-0 font-mono"}
                />
                <GeneratePasswordButton onGenerate={setAdminPassword} />
              </div>
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
              <div className="flex gap-1.5">
                <input
                  placeholder="Staff password"
                  value={staffPassword}
                  onChange={(e) => setStaffPassword(e.target.value)}
                  className={inputClass + " flex-1 min-w-0 font-mono"}
                />
                <GeneratePasswordButton onGenerate={setStaffPassword} />
              </div>
            </div>
          )}
        </div>
      )}

      {selectedType?.has_rfid && (
        <input
          placeholder="RFID number"
          value={rfid}
          onChange={(e) => setRfid(e.target.value)}
          className={inputClass + " w-full font-mono"}
          autoComplete="off"
          spellCheck={false}
        />
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

      <div className="flex flex-wrap items-center gap-2 pt-1">
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

        <div className="ml-auto flex flex-wrap items-center gap-2">
          {/* Archive (soft) — always available */}
          {!confirmArchive && (
            <button
              type="button"
              onClick={() => {
                setConfirmArchive(true);
                setConfirmDelete(false);
              }}
              className="rounded-md px-3 py-1.5 text-xs text-muted-foreground hover:bg-accent"
            >
              {asset.is_active ? "Archive" : "Restore"}
            </button>
          )}
          {confirmArchive && (
            <div className="flex items-center gap-1">
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

          {/* Delete (hard, permanent) — admin only, matches RLS */}
          {isAdmin && !confirmDelete && (
            <button
              type="button"
              onClick={() => {
                setConfirmDelete(true);
                setConfirmArchive(false);
              }}
              className="rounded-md px-3 py-1.5 text-xs text-red-400 hover:bg-red-500/10 hover:text-red-300"
            >
              Delete
            </button>
          )}
          {isAdmin && confirmDelete && (
            <div className="flex items-center gap-1">
              <span className="text-[11px] text-muted-foreground">Delete permanently?</span>
              <button
                type="button"
                onClick={handleDelete}
                disabled={saving}
                className="rounded-md bg-red-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-600 disabled:opacity-50"
              >
                {saving ? "Deleting…" : "Confirm delete"}
              </button>
              <button
                type="button"
                onClick={() => setConfirmDelete(false)}
                className="rounded-md border border-border px-3 py-1.5 text-xs text-muted-foreground hover:bg-accent"
              >
                No
              </button>
            </div>
          )}
        </div>
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
