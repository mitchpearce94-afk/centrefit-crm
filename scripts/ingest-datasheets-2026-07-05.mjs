// 2026-07-05 — ingest Mitchell's own datasheet PDFs (primary source per
// docs/documentation-CONTEXT.md) into the private `datasheets` bucket + table.
// Idempotent: re-running overwrites the storage object and upserts by model.
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const env = Object.fromEntries(
  readFileSync(new URL("../.env.gc-probe", import.meta.url), "utf8")
    .split("\n").filter((l) => l.includes("="))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, "").replace(/\\r|\\n/g, "").trim()]; }),
);
const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const DIR = "C:/Users/mitch/AppData/Local/Temp/claude/C--Users-mitch-Projects/939582bf-f696-4d6e-b7ef-ef6570134e23/scratchpad/datasheets";

const SHEETS = [
  { file: "dahua-nvr42xx.pdf", manufacturer: "Dahua", model: "DHI-NVR4216/4232-16P-4KS2", product: "Lite Series 16/32ch 16PoE 4K NVR", match: ["DHI-NVR4216-16P-4KS2", "DHI-NVR4232-16P-4KS2"] },
  { file: "dahua-cam-3666emp.pdf", manufacturer: "Dahua", model: "DH-IPC-HDW3666EMP", product: "6MP eyeball IP camera", match: ["DH-IPC-HDW3666EMP"] },
  { file: "dlink-dapx2850.pdf", manufacturer: "D-Link", model: "DAP-X2850", product: "AX3600 WiFi 6 access point", match: ["DAP-X2850"] },
  { file: "dlink-dgs1210.pdf", manufacturer: "D-Link", model: "DGS-1210 Series", product: "Smart managed switch series", match: ["DGS-1210"] },
  { file: "dlink-dslx3052e.pdf", manufacturer: "D-Link", model: "DSL-X3052E", product: "AX3000 VDSL/ADSL modem router", match: ["DSL-X3052E"] },
  { file: "pd-prm240.pdf", manufacturer: "Power Dynamics", model: "PRM240", product: "100V 6-channel mixer-amplifier 240W", match: ["PRM240", "PRM120"] },
  { file: "pd-wall-speaker.pdf", manufacturer: "Power Dynamics", model: "BC Series", product: "100V in/outdoor wall speaker set", match: ["BC40", "BC50", "BC65"] },
  { file: "pd-ceiling-speaker.pdf", manufacturer: "Power Dynamics", model: "NCSP Series", product: "100V low-profile ceiling speaker", match: ["NCSP5", "NCSP6", "NCSP8"] },
  { file: "kingray-active-tap.pdf", manufacturer: "Kingray", model: "KAT Series", product: "Active tap 47-2400MHz (8/16/24/32-way)", match: ["KAT8F", "KAT16F", "KAT24F", "KAT32F"] },
  { file: "gsm-duress-intercom.pdf", manufacturer: null, model: "GSM Duress Intercom", product: "GSM duress intercom (anti-vandal, IP55, dials 3 numbers)", match: ["GSM Duress Intercom"] },
  { file: "bosch-solution-6000.pdf", manufacturer: "Bosch", model: "Solution 6000", product: "Solution 6000 alarm system", match: ["Solution 6000", "CC610GWP"] },
  { file: "electrocraft-modulator.pdf", manufacturer: "Electrocraft", model: "EPS-HDMI1001M4", product: "1x HDMI DVB-T modulator (MPEG4)", match: ["EPS-HDMI1001 / M4", "EPS-HDM1001M4", "EPS-HDMI1001M4"] },
  { file: "bosch-ds936.pdf", manufacturer: "Bosch", model: "DS936", product: "360-degree ceiling-mount panoramic PIR", match: ["DS936"] },
];

for (const s of SHEETS) {
  const bytes = readFileSync(`${DIR}/${s.file}`);
  const path = `library/${s.file}`;
  const { error: upErr } = await supabase.storage
    .from("datasheets")
    .upload(path, bytes, { contentType: "application/pdf", upsert: true });
  if (upErr) { console.error(`FAIL upload ${s.file}: ${upErr.message}`); continue; }
  const { error: rowErr } = await supabase.from("datasheets").upsert({
    manufacturer: s.manufacturer,
    model: s.model,
    product_name: s.product,
    match_models: s.match,
    storage_path: path,
    mime_type: "application/pdf",
    size_bytes: bytes.length,
    source: "upload",
    notes: "Supplied by Mitchell 2026-07-05",
    updated_at: new Date().toISOString(),
  }, { onConflict: "model" });
  if (rowErr) { console.error(`FAIL row ${s.model}: ${rowErr.message}`); continue; }
  console.log(`OK    ${s.model}  (${(bytes.length / 1024).toFixed(0)} KB)`);
}

const { count } = await supabase.from("datasheets").select("id", { count: "exact", head: true });
console.log(`\nLibrary now holds ${count} datasheets.`);
