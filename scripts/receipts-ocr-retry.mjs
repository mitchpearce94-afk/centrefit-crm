#!/usr/bin/env node
// Re-run OCR on receipts stuck in ocr_status failed/pending, straight against
// the Cortex LLM bridge on this box (127.0.0.1:4890 — subscription, no API
// key). Same extraction + column writes as src/lib/receipts/snap.ts.
//
//   node scripts/receipts-ocr-retry.mjs [--dry] [--limit N]
//
// Env: NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY from .env.gc-probe
// (values may carry a literal "\n" — stripped); CORTEX_LLM_TOKEN from ~/.cortex/env.
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const args = process.argv.slice(2);
const DRY = args.includes("--dry");
const LIMIT = Number(args[args.indexOf("--limit") + 1] || 100);
const env = (file, key) => {
  const m = readFileSync(file, "utf8").split("\n").find((l) => l.startsWith(`${key}=`));
  return m ? m.slice(key.length + 1).trim().replace(/^"|"$/g, "").replace(/\\n$/, "").replace(/\r$/, "") : "";
};
const URL_ = env(".env.gc-probe", "NEXT_PUBLIC_SUPABASE_URL");
const KEY = env(".env.gc-probe", "SUPABASE_SERVICE_ROLE_KEY");
const TOKEN = env(join(homedir(), ".cortex", "env"), "CORTEX_LLM_TOKEN");
const PORT = env(join(homedir(), ".cortex", "env"), "CORTEX_LLM_PORT") || "4890";
if (!URL_ || !KEY || !TOKEN) { console.error("missing env"); process.exit(1); }
const H = { apikey: KEY, authorization: `Bearer ${KEY}` };

const PROMPT =
  "This is a purchase receipt. Extract the GRAND TOTAL actually paid (GST/tax inclusive) as a plain number, the vendor/merchant name, and the purchase date. " +
  'Respond with ONLY a JSON object, no prose, no code fences: {"amount": <number|null>, "vendor": <string|null>, "date": <"YYYY-MM-DD"|null>}.';
const MIME = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", gif: "image/gif" };

const rows = await (await fetch(`${URL_}/rest/v1/receipts?select=id,storage_path,ocr_status,vendor,amount&ocr_status=in.(failed,pending)&order=created_at.asc&limit=${LIMIT}`, { headers: H })).json();
console.log(`${rows.length} receipts to retry${DRY ? " (dry run)" : ""}`);
let done = 0, failed = 0;
for (const r of rows) {
  const ext = (r.storage_path.split(".").pop() || "jpg").toLowerCase();
  const mime = MIME[ext];
  if (!mime) { console.log(`skip ${r.id} (${ext})`); failed++; continue; }
  const img = await fetch(`${URL_}/storage/v1/object/receipts/${r.storage_path}`, { headers: H });
  if (!img.ok) { console.log(`no image ${r.id} HTTP ${img.status}`); failed++; continue; }
  const data = Buffer.from(await img.arrayBuffer()).toString("base64");
  const t0 = Date.now();
  const res = await fetch(`http://127.0.0.1:${PORT}/api/llm`, {
    method: "POST", headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
    body: JSON.stringify({ prompt: PROMPT, model: "haiku", json: true, image: { data, mime }, timeout_ms: 90_000 }),
  });
  const out = res.ok ? await res.json() : null;
  const p = out && out.json && typeof out.json === "object" ? out.json : {};
  const amount = typeof p.amount === "number" ? p.amount : p.amount != null && !Number.isNaN(Number(p.amount)) ? Number(p.amount) : null;
  const vendor = typeof p.vendor === "string" && p.vendor.trim() ? p.vendor.trim().slice(0, 120) : null;
  const date = typeof p.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(p.date) ? p.date : null;
  const okRead = res.ok && (amount != null || vendor);
  console.log(`${okRead ? "ok  " : "FAIL"} ${r.id.slice(0, 8)} ${Date.now() - t0}ms ${vendor ?? "-"} ${amount ?? "-"} ${date ?? "-"}${res.ok ? "" : ` HTTP ${res.status}`}`);
  if (DRY) continue;
  const patch = okRead
    ? { vendor, amount, receipt_date: date, ocr_status: "done", updated_at: new Date().toISOString() }
    : { ocr_status: "failed", updated_at: new Date().toISOString() };
  const u = await fetch(`${URL_}/rest/v1/receipts?id=eq.${r.id}`, { method: "PATCH", headers: { ...H, "content-type": "application/json", prefer: "return=minimal" }, body: JSON.stringify(patch) });
  if (!u.ok) console.log(`  update failed HTTP ${u.status} ${await u.text()}`);
  okRead ? done++ : failed++;
}
console.log(`done=${done} failed=${failed}`);
