// 2026-07-05 (arvo) — ingest the two registry-verified Dahua datasheets the
// asset register needs but Mitchell's own PDF set didn't cover: the
// DHI-NVR5432-16P-AI/ANZ (Snap Neutral Bay's recorder, in the key product
// set) and the DH-IPC-HDW3667EM-S-IL-ANZ camera (covers -BLK). Idempotent:
// overwrites the storage object and upserts by model.
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const env = Object.fromEntries(
  readFileSync(new URL("../.env.gc-probe", import.meta.url), "utf8")
    .split("\n").filter((l) => l.includes("="))
    .map((l) => { const i = l.indexOf("="); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, "").replace(/\\r|\\n/g, "").trim()]; }),
);
const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const SHEETS = [
  {
    url: "https://material.dahuasecurity.com/uploads/soft/20230217/NVR5432-16P-AIANZ.pdf",
    file: "library/dahua-nvr5432.pdf",
    manufacturer: "Dahua",
    model: "DHI-NVR5432-16P-AI/ANZ",
    product: "32ch 16PoE WizSense NVR",
    match: ["DHI-NVR5432-16P-AI/ANZ", "DHI-NVR5432-16P-AI"],
  },
  {
    url: "https://materialfile.dahuasecurity.com/uploads/soft/20250416/DH-IPC-HDW3667EM-S-IL-ANZ.pdf",
    file: "library/dahua-cam-3667em.pdf",
    manufacturer: "Dahua",
    model: "DH-IPC-HDW3667EM-S-IL-ANZ",
    product: "6MP WizSense eyeball IP camera",
    match: ["DH-IPC-HDW3667EM-S-IL-ANZ", "DH-IPC-HDW3667EM-S-IL-ANZ-BLK"],
  },
];

for (const sheet of SHEETS) {
  const res = await fetch(sheet.url, { headers: { "User-Agent": "Mozilla/5.0" } });
  if (!res.ok) { console.error(`${sheet.model}: download failed HTTP ${res.status}`); process.exit(1); }
  const buf = Buffer.from(await res.arrayBuffer());
  if (!buf.subarray(0, 5).toString().startsWith("%PDF")) {
    console.error(`${sheet.model}: not a PDF (${buf.length} bytes)`); process.exit(1);
  }
  const { error: upErr } = await supabase.storage.from("datasheets").upload(sheet.file, buf, { contentType: "application/pdf", upsert: true });
  if (upErr) { console.error(`${sheet.model}: upload failed ${upErr.message}`); process.exit(1); }
  const { error: rowErr } = await supabase.from("datasheets").upsert({
    manufacturer: sheet.manufacturer,
    model: sheet.model,
    product_name: sheet.product,
    match_models: sheet.match,
    storage_path: sheet.file,
    mime_type: "application/pdf",
    size_bytes: buf.length,
    source: "url",
    notes: `Registry-verified official Dahua PDF (${sheet.url})`,
    updated_at: new Date().toISOString(),
  }, { onConflict: "model" });
  if (rowErr) { console.error(`${sheet.model}: row failed ${rowErr.message}`); process.exit(1); }
  console.log(`OK ${sheet.model} — ${buf.length} bytes → ${sheet.file}`);
}
