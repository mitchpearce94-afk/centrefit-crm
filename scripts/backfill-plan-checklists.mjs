// One-off backfill: publish plan_items for every existing plan (mirrors
// /api/plans/[id]/publish-checklist — service role, so run responsibly).
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const env = Object.fromEntries(
  readFileSync(new URL("../.env.gc-probe", import.meta.url), "utf8")
    .split("\n").filter((l) => l.includes("="))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, "").replace(/\\r|\\n/g, "").replace(/\r|\n/g, "").trim()];
    }),
);
const svc = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

// Mirror of NUMBERED_GROUPS + GROUP_PREFIX in the publish route.
const PREFIX_BY_DEVICE = {};
for (const [prefix, ids] of [
  ["CAM", ["cam-black", "cam-white"]],
  ["PIR", ["pir-wall", "pir-ceiling"]],
  ["SPK", ["speaker-roof", "speaker-roof-gear", "speaker-wall", "speaker-wall-filled", "speaker-roof-white", "speaker-roof-black", "speaker-wall-white", "speaker-wall-black"]],
  ["D", ["cat6-data", "rg6-coax"]],
  ["AP", ["wifi-ap"]],
]) for (const id of ids) PREFIX_BY_DEVICE[id] = prefix;

// Catalogue names (subset match not needed — fall back to device id).
const NAMES = {
  "cam-black": "Black Camera", "cam-white": "White Camera", "cam-tg": "Tail Gating Camera",
  "sensor-tg": "Tail Gating Sensor", "alarm-panel": "Alarm Panel", "alarm-keypad": "Alarm Keypad",
  "pir-wall": "PIR Wall Mount", "pir-ceiling": "PIR 360° Ceiling", "reed-switch": "Reed Switch",
  "rf-receiver": "RF Receiver", "door-strike": "Door Strike", "mag-lock": "Mag Lock",
  "duress-btn": "Duress Button", "duress-pendant": "Duress Pendant", "duress-intercom": "Duress Intercom",
  "break-glass": "Break Glass", "ext-siren": "External Light & Siren", "siren-piezo": "Piezo Siren",
  "bio-access": "BIO Access Control", "swipe-card": "Swipe Card Reader", "rex": "REX Request to Exit",
  "volume-control": "Volume Control",
  "speaker-roof-white": "Speaker Roof (White)", "speaker-roof-black": "Speaker Roof (Black)",
  "speaker-wall-white": "Speaker Wall (White)", "speaker-wall-black": "Speaker Wall (Black)",
  "wifi-ap": "Wi-Fi Access Point", "cat6-data": "Cat6 Data Point", "rg6-coax": "RG6 Coaxial Point",
  "integration-cable": "Integration Cable", "server-9ru": "Server Cabinet 9RU",
  "server-27ru": "Server Cabinet 27RU", "server-32ru": "Server Cabinet 32RU", "server-42ru": "Server Cabinet 42RU",
  "intercom-master": "Video Intercom Master", "intercom-slave": "Video Intercom Slave",
  "comms-rack": "Comms Rack",
};

const { data: plans, error } = await svc
  .from("plan_files")
  .select("id, name, job_id, cfp_url")
  .not("cfp_url", "is", null);
if (error) { console.error(error.message); process.exit(1); }

let done = 0, skipped = 0;
for (const plan of plans) {
  const res = await fetch(plan.cfp_url).catch(() => null);
  if (!res?.ok) { console.log(`skip ${plan.name} (cfp fetch ${res?.status ?? "failed"})`); skipped++; continue; }
  let cfp;
  try { cfp = await res.json(); } catch { console.log(`skip ${plan.name} (bad json)`); skipped++; continue; }

  const customNames = new Map((cfp.customDevices ?? []).map((d) => [d.id, d.name]));
  const now = new Date().toISOString();
  const rows = [];
  (cfp.floors ?? []).forEach((floor, fi) => {
    (floor.devices ?? []).forEach((device, di) => {
      if (!device?.instanceId || !device?.deviceId) return;
      const name = NAMES[device.deviceId] ?? customNames.get(device.deviceId) ?? device.deviceId;
      const isData = device.deviceId === "cat6-data" || device.deviceId === "rg6-coax";
      const qty = isData ? Math.max(1, device.dataCount ?? 1) : 1;
      const prefix = PREFIX_BY_DEVICE[device.deviceId] ?? "";
      let label;
      if (prefix && typeof device.labelNum === "number") {
        const tag = qty > 1 ? `${prefix}${device.labelNum}–${prefix}${device.labelNum + qty - 1}` : `${prefix}${device.labelNum}`;
        label = `${tag} · ${name}`;
      } else label = name;
      if (device.provisional) label += " (cable only)";
      rows.push({
        plan_file_id: plan.id, job_id: plan.job_id ?? null,
        floor_id: floor.id ?? null, floor_name: floor.name ?? null,
        instance_id: device.instanceId, device_id: device.deviceId,
        label, qty, orphaned: false, sort_order: fi * 1000 + di, updated_at: now,
      });
    });
  });

  if (rows.length === 0) { console.log(`skip ${plan.name} (no devices)`); skipped++; continue; }
  const { error: upErr } = await svc.from("plan_items").upsert(rows, { onConflict: "plan_file_id,instance_id" });
  if (upErr) { console.log(`FAIL ${plan.name}: ${upErr.message}`); skipped++; continue; }
  console.log(`ok   ${plan.name}: ${rows.length} items${plan.job_id ? "" : "  (no linked job)"}`);
  done++;
}
console.log(`\nBackfilled ${done} plans, skipped ${skipped}.`);
