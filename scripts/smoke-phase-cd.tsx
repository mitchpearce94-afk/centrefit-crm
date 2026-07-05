/**
 * Phase C+D local smoke: renders the SWMS PDF and Wi-Fi poster with sample
 * data, and assembles a real handover pack (read-only) for a live site.
 * Run: npx --yes tsx scripts/smoke-phase-cd.tsx <outDir> [siteId]
 */
import fs from "fs";
import path from "path";
import { createClient } from "@supabase/supabase-js";
import { generateSwmsPdfBuffer } from "../src/lib/swms/pdf";
import { SWMS_TASK_GROUPS, nearestHospital } from "../src/lib/swms/spec";
import { renderWifiPosterPdf } from "../src/lib/handover/wifi-poster";
import { buildHandoverInput, assembleHandoverPack } from "../src/lib/handover/assemble";

const outDir = process.argv[2] ?? ".";
const siteId = process.argv[3] ?? "dad166eb-ed43-47c3-849c-fd3cb8e497fa"; // Core Plus Benowa

const SIG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

const env = Object.fromEntries(
  fs.readFileSync(path.join(__dirname, "../.env.gc-probe"), "utf8")
    .split("\n").filter((l) => l.includes("="))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, "").replace(/\\r|\\n/g, "").trim()]; }),
);

async function main() {
  // 1 — SWMS
  const hosp = nearestHospital(-27.4475, 153.0273);
  const swms = await generateSwmsPdfBuffer({
    clientName: "Snap Fitness Testville Pty Ltd",
    clientAbn: "11 696 226 454",
    clientAddress: "Tenancy 3, 41 George Street, Brisbane QLD 4000",
    clientKeyReps: "David Noonan, Matt Fallon",
    workSiteName: "Snap Fitness Testville",
    workSiteAddress: "Tenancy 3, 41 George Street, Brisbane QLD 4000",
    proposedWorkDate: "July 2026 – September 2026",
    permitNumber: "CF1386-1",
    author: "Mitchell Pearce",
    generatedDate: "05/07/2026",
    taskGroups: SWMS_TASK_GROUPS,
    nearestHospital: `${hosp.name}, ${hosp.address}`,
    approver: { name: "Mark Pearce", role: "Technical Solutions Director", signatureDataUrl: SIG },
    signOn: [
      { name: "Mark Pearce", role: "Technical Solutions Director", signatureDataUrl: SIG, date: "05/07/2026" },
      { name: "Michael Murphy", role: "Installation Manager", signatureDataUrl: null, date: "05/07/2026" },
    ],
    subcontractors: [{ name: "Sub One", company: "SubCo", licences: "White Card, EWP" }],
  });
  fs.writeFileSync(path.join(outDir, "smoke-swms.pdf"), swms);
  console.log("SWMS OK:", swms.length, "bytes");

  // 2 — Wi-Fi poster
  const poster = await renderWifiPosterPdf({ siteName: "Snap Fitness Testville", ssid: "Snap Fitness Guest", password: "Du8rAc@e8+t+" });
  fs.writeFileSync(path.join(outDir, "smoke-wifi-poster.pdf"), poster);
  console.log("Poster OK:", poster.length, "bytes");

  // 3 — Handover pack (read-only against live data)
  const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL!, env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const input = await buildHandoverInput(sb, siteId);
  console.log("Handover input:", JSON.stringify({
    site: input.siteName,
    client: input.clientName,
    entries: input.entries.map((e) => e.model),
    wifi: input.wifi.map((w) => w.ssid),
    procedures: input.procedures.map((p) => p.key),
  }, null, 2));
  const pack = await assembleHandoverPack(sb, input);
  fs.writeFileSync(path.join(outDir, "smoke-handover.pdf"), pack);
  console.log("Handover pack OK:", pack.length, "bytes");
}

main().catch((err) => {
  console.error("FAILED:", err);
  process.exit(1);
});
