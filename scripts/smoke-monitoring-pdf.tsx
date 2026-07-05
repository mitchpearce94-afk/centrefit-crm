/**
 * One-off local smoke test for the monitoring form PDF renderer (Phase B).
 * Run: npx --yes tsx scripts/smoke-monitoring-pdf.tsx <out.pdf>
 */
import fs from "fs";
import { generateMonitoringFormPdfBuffer } from "../src/lib/monitoring-form/pdf";
import { buildEmptyOpeningHours, feeFromIncGst, type MonitoringPrefill, type MonitoringFormData } from "../src/lib/monitoring-form/spec";

// 1x1 transparent PNG — enough to exercise the Image path.
const SIG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

const prefill: MonitoringPrefill = {
  siteName: "Snap Fitness Testville",
  details: {
    clientName: "Testville Fitness Pty Ltd",
    billingContactName: "Sam Manager",
    abn: "11 222 333 444",
    facilityName: "Snap Fitness Testville",
    facilityAddress: "1 Example St, Testville QLD 4000",
    facilityPhone: "(07) 3000 0000",
    billingAddress: "PO Box 1, Testville QLD 4000",
    nearestCrossStreet: "Sample Rd",
    email: "sam@example.com",
    newClient: true,
    commencementDate: "2026-08-01",
    simPhone: "",
    facility247: false,
  },
  selections: {},
  callList: [],
  ifobUsers: [],
  openingHours: {},
  zoneSchedule: [
    { zone: "1", name: "PIR Reception", description: "Reception ceiling 360" },
    { zone: "2", name: "PIR Gym Floor", description: "Main gym floor" },
    { zone: "3", name: "Reed Front Door", description: "Front entry" },
  ],
  fees: {
    monitoring: feeFromIncGst("security-monitoring", "Security Monitoring", 71.5, "monthly"),
    app: feeFromIncGst("myalarm-app", "MyAlarm App Subscription", 146.85, "yearly"),
    vav: feeFromIncGst("VAV", "Video Alarm Verification", 35, "monthly"),
    sim: feeFromIncGst("sim-card", "SIM Card", 24.75, "monthly"),
    nbn: feeFromIncGst("nbn-100-40", "NBN Plan - 100/40", 139, "monthly"),
  },
  isReissue: false,
  docVersion: 1,
  generatedAt: new Date().toISOString(),
};

const formData: MonitoringFormData = {
  details: prefill.details,
  selections: {
    late_to_close: "L2",
    out_of_hours: "H2",
    holdup: "P2",
    sim_supply: "centrefit",
    burglar: "B2",
    apply_scope: "A",
    vav: "C1",
    power_fail: "AC1",
    battery_fail: "BF1",
  },
  callList: [
    { name: "Sam Manager", phone: "0400 000 001" },
    { name: "Alex Owner", phone: "0400 000 002" },
  ],
  ifobUsers: [
    { name: "Sam Manager", pin: "1234", app_access: true },
    { name: "Alex Owner", pin: "***9", app_access: false },
  ],
  openingHours: { ...buildEmptyOpeningHours(), mon: { open: "05:00", close: "21:00", cleaner: "10am", h24: false } },
  sectionsViewed: Object.fromEntries(
    ["details", "call_list", "ifob", "hours", "late_to_close", "out_of_hours", "holdup", "sim", "burglar", "apply_scope", "vav", "power_fail", "battery_fail", "servicing", "fees", "liability", "sign"].map(
      (k) => [k, new Date().toISOString()],
    ),
  ),
};

async function main() {
  const buf = await generateMonitoringFormPdfBuffer({
    prefill,
    formData,
    signerName: "Sam Manager",
    signerPosition: "Facility Manager",
    signatureDataUrl: SIG,
    recipientEmail: "sam@example.com",
    requestId: "00000000-0000-0000-0000-000000000000",
    sentAt: new Date().toISOString(),
    viewedAt: new Date().toISOString(),
    signedAt: new Date().toISOString(),
    signerIp: "203.0.113.7",
    signerUserAgent: "SmokeTest/1.0",
  });
  const out = process.argv[2] ?? "smoke-monitoring.pdf";
  fs.writeFileSync(out, buf);
  console.log(`OK — wrote ${out} (${buf.length} bytes)`);
}

main().catch((err) => {
  console.error("FAILED:", err);
  process.exit(1);
});
