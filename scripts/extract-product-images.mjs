// One-off bulk import: extract in-cell pictures from
// "IT Equipment Listing and Pricing Template.xlsx" → match to existing
// quote_products by SKU → upload to Supabase Storage → set image_url.
//
// Run with: node scripts/extract-product-images.mjs
// Requires: SUPABASE_SERVICE_ROLE_KEY env var (admin write to storage + DB).

import fs from 'node:fs';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';

const XLSX_DIR = String.raw`C:\Users\mitch\AppData\Local\Temp\xlsx-peek`;
const SUPABASE_URL = 'https://zybdcnlcqncbxjrthtgy.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const BUCKET = 'product-images';
const DRY_RUN = process.env.DRY_RUN === '1';

if (!SUPABASE_KEY && !DRY_RUN) {
  console.error('Set SUPABASE_SERVICE_ROLE_KEY env var (or DRY_RUN=1 to skip uploads)');
  process.exit(1);
}

// ── Step 1: build the rich-data resolution chain ──────────────────────────

const read = (p) => fs.readFileSync(path.join(XLSX_DIR, p), 'utf8');

const rIdMap = Object.fromEntries(
  [...read('xl/richData/_rels/richValueRel.xml.rels')
    .matchAll(/<Relationship Id="(rId\d+)"[^>]*Target="([^"]+)"/g)]
    .map((m) => [m[1], m[2]]),
);

const rels = [...read('xl/richData/richValueRel.xml')
  .matchAll(/<rel\s+r:id="(rId\d+)"/g)].map((m) => m[1]);

const rvs = [...read('xl/richData/rdrichvalue.xml')
  .matchAll(/<rv s="\d+">(.*?)<\/rv>/g)]
  .map((m) => parseInt(m[1].match(/<v>(\d+)<\/v>/)[1]));

const meta = read('xl/metadata.xml');
const xlrvSection = meta.match(/<futureMetadata name="XLRICHVALUE"[^>]*>([\s\S]*?)<\/futureMetadata>/)[1];
const blocks = [...xlrvSection.matchAll(/<xlrd:rvb i="(\d+)"\/>/g)].map((m) => parseInt(m[1]));

function vmToImage(vm) {
  const rvIdx = blocks[vm - 1];
  if (rvIdx === undefined) return null;
  const lii = rvs[rvIdx];
  if (lii === undefined) return null;
  const rId = rels[lii];
  if (!rId) return null;
  const target = rIdMap[rId];
  if (!target) return null;
  return path.join(XLSX_DIR, target.replace('../', 'xl/'));
}

// ── Step 2: walk product sheets, extract per-row image + SKU ─────────────

const sst = read('xl/sharedStrings.xml');
const strings = [];
for (const m of sst.matchAll(/<si[^>]*>([\s\S]*?)<\/si>/g)) {
  const ts = [...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((x) => x[1]);
  strings.push(ts.join(''));
}

const targetSheets = [
  ['Access Control', 'sheet12.xml'],
  ['AV System', 'sheet13.xml'],
  ['Data System', 'sheet14.xml'],
  ['Digital Surveillance', 'sheet15.xml'],
  ['Digital Surveillance DLink', 'sheet16.xml'],
  ['Security System', 'sheet17.xml'],
  ['Audio System', 'sheet18.xml'],
  ['9Rounds', 'sheet19.xml'],
  ['Internet Plans', 'sheet20.xml'],
  ['VoiP', 'sheet21.xml'],
  ['Biometrics', 'sheet22.xml'],
  ['Fibre System', 'sheet23.xml'],
  ['Miscellaneous', 'sheet24.xml'],
];

function cellValue(inner, ref) {
  const re = new RegExp(`<c r="${ref}"(?:[^>]*?t="(\\w+)")?[^>]*>(?:<v>([^<]+)<\\/v>)?<\\/c>`);
  const m = inner.match(re);
  if (!m) return null;
  const t = m[1];
  const v = m[2];
  if (v == null) return null;
  if (t === 's') return strings[parseInt(v)] ?? null;
  return v;
}

function cellVm(inner, ref) {
  const re = new RegExp(`<c r="${ref}"[^>]*vm="(\\d+)"`);
  const m = inner.match(re);
  return m ? parseInt(m[1]) : null;
}

const extracted = [];
for (const [label, file] of targetSheets) {
  const sheetPath = path.join(XLSX_DIR, 'xl/worksheets', file);
  if (!fs.existsSync(sheetPath)) continue;
  const xml = fs.readFileSync(sheetPath, 'utf8');
  for (const rm of xml.matchAll(/<row r="(\d+)"[^>]*>([\s\S]*?)<\/row>/g)) {
    const row = parseInt(rm[1]);
    if (row < 2) continue;
    const inner = rm[2];
    const vm = cellVm(inner, `B${row}`);
    if (!vm) continue;
    const imagePath = vmToImage(vm);
    if (!imagePath || !fs.existsSync(imagePath)) continue;
    const sku = cellValue(inner, `F${row}`)?.trim();
    const name = cellValue(inner, `A${row}`)?.trim();
    if (!sku) continue;
    extracted.push({ sheet: label, row, sku, name: name?.slice(0, 80) ?? '', imagePath });
  }
}

console.log(`Extracted ${extracted.length} products with images`);
const bySheet = {};
for (const e of extracted) bySheet[e.sheet] = (bySheet[e.sheet] ?? 0) + 1;
console.log('By sheet:');
for (const [k, v] of Object.entries(bySheet)) console.log(`  ${k}: ${v}`);
console.log('First 5:');
for (const e of extracted.slice(0, 5)) console.log(`  [${e.sheet} r${e.row}] ${e.sku} | ${e.name?.slice(0, 50)} → ${path.basename(e.imagePath)}`);
if (extracted.length === 0) process.exit(0);

if (DRY_RUN) {
  console.log('\nDRY_RUN — exiting without uploading');
  process.exit(0);
}

// ── Step 3: match against DB and upload ──────────────────────────────────

const supa = createClient(SUPABASE_URL, SUPABASE_KEY);
const { data: products } = await supa
  .from('quote_products')
  .select('id, sku, name')
  .eq('is_active', true);
console.log(`DB has ${products?.length ?? 0} active products`);

const skuLookup = new Map();
for (const p of products ?? []) {
  if (p.sku) skuLookup.set(p.sku.trim().toLowerCase(), p);
}

let matched = 0, uploaded = 0, skipped = 0, errors = 0;
for (const e of extracted) {
  const product = skuLookup.get(e.sku.toLowerCase());
  if (!product) { skipped++; continue; }
  matched++;

  const ext = path.extname(e.imagePath) || '.png';
  const storageKey = `${product.id}${ext}`;
  const buffer = fs.readFileSync(e.imagePath);

  const upload = await supa.storage.from(BUCKET).upload(storageKey, buffer, {
    contentType: ext === '.png' ? 'image/png' : 'image/jpeg',
    upsert: true,
  });
  if (upload.error) { console.error('upload err', e.sku, upload.error.message); errors++; continue; }

  const { data: pub } = supa.storage.from(BUCKET).getPublicUrl(storageKey);
  const imageUrl = pub.publicUrl;
  const { error: updateErr } = await supa.from('quote_products').update({ image_url: imageUrl }).eq('id', product.id);
  if (updateErr) { console.error('update err', e.sku, updateErr.message); errors++; continue; }
  uploaded++;
  if (uploaded % 20 === 0) console.log(`  ${uploaded} uploaded...`);
}

console.log(`\nDone. Matched ${matched}/${extracted.length}, uploaded ${uploaded}, skipped (no SKU match) ${skipped}, errors ${errors}`);
